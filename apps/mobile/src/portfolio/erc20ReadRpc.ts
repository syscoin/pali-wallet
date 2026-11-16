import { createBoundedRpcFetch } from '../custody/boundedRpcFetch.ts';
import { createErc20BalanceBatch } from '../../../../source/shared/erc20BalanceBatch.ts';
import {
  ERC20_TEXT_LIMITS,
  parseErc20BalancePair,
  parseErc20Decimals,
  parseErc20Text,
  parseErc20Units,
} from '../../../../source/shared/erc20.ts';
import { normalizeErc20Address, parseErc20Metadata } from './erc20Metadata.ts';
import type { Erc20Metadata } from '../../../../source/shared/erc20.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import {
  getNativeNetwork,
  snapshotNativeNetwork,
} from '../custody/networkContext.ts';
import type {
  EvmNetworkId,
  NativeNetworkRegistration,
} from '../custody/networkContext.ts';
import { parseRpcQuantity } from '../platformRpc.ts';
import {
  JsonRpcReadClient,
  RpcReadCapabilities,
  RpcReadError,
} from '@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js';

export type { Erc20Metadata } from '../../../../source/shared/erc20.ts';
export type Erc20BalanceResult = Readonly<
  { status: 'available'; units: string } | { status: 'error'; units: null }
>;
export interface Erc20Reader {
  readBalances?(
    network: EvmNetworkId,
    address: string,
    tokens: readonly Erc20Metadata[],
    signal: AbortSignal,
    assertCurrent?: () => void,
    phase?: PortfolioReadPhase
  ): Promise<readonly Erc20BalanceResult[]>;
  readToken(
    network: EvmNetworkId,
    address: string,
    contractAddress: string,
    signal: AbortSignal
  ): Promise<Readonly<{ metadata: Erc20Metadata; units: string }>>;
  readBalance(
    network: EvmNetworkId,
    address: string,
    token: Erc20Metadata,
    signal: AbortSignal
  ): Promise<Readonly<{ units: string }>>;
}
export class Erc20ReadError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'INVALID_INPUT'
    | 'INVALID_RESPONSE'
    | 'UNAVAILABLE'
    | 'WRONG_CHAIN'
    | 'CHANGED_PRECISION';
  constructor(code: Erc20ReadError['code']) {
    super(code);
    this.name = 'Erc20ReadError';
    this.code = code;
  }
}
type Method =
  | 'eth_chainId'
  | 'eth_getBlockByNumber'
  | 'eth_getCode'
  | 'eth_call';
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type ReadOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
  registrations?: () => readonly NativeNetworkRegistration[] | undefined;
};
type ReadRequest = Readonly<{ method: Method; params: readonly unknown[] }>;
type Read = ((
  method: Method,
  params: readonly unknown[],
  captureRpcError?: true
) => Promise<unknown>) & {
  many(
    requests: readonly ReadRequest[]
  ): Promise<PromiseSettledResult<unknown>[]>;
  scoped(signal: AbortSignal, timeoutMs: number, cancel: () => void, concurrency?: number): Read;
  signal: AbortSignal;
  canBatch(): boolean;
};
type CapturedScope = Readonly<{
  network: NativeNetworkRegistration;
  assertCurrent(): void;
}>;

export type PortfolioReadPhase = Readonly<{ kind: 'portfolio' }>;
const portfolioPhases = new WeakMap<PortfolioReadPhase, {
  network: NativeNetworkRegistration; holder: string; read: Read; block: string;
  signal: AbortSignal; check(): void;
}>();
async function inPortfolioPhase<T>(phase: PortfolioReadPhase, network: NativeNetworkRegistration,
  holder: string, signal: AbortSignal, guard: () => void,
  work: (read: Read, block: string, holder: string) => Promise<T>): Promise<T> {
  const owned = portfolioPhases.get(phase);
  if (!owned || owned.network.registrationHash !== network.registrationHash ||
    owned.network.rpcUrl !== network.rpcUrl || owned.holder !== normalizePublicAddress(holder, network.id) || owned.signal !== signal)
    return fail('INVALID_INPUT');
  owned.check(); guard();
  const value = await work(owned.read, owned.block, owned.holder);
  owned.check(); guard();
  return value;
}

/** One identity/header envelope for a mixed saved-asset snapshot. */
export function createPortfolioReadOperation(options: SelectedNftReadOptions) {
  const operation = createReadOperation(options, 32 * 1024);
  return async <T>(networkId: EvmNetworkId, address: string, count: number, signal: AbortSignal,
    guard: () => void, work: (phase: PortfolioReadPhase) => Promise<T>): Promise<T> => {
    if (!Number.isSafeInteger(count) || count < 1 || count > 256) return fail('INVALID_INPUT');
    const network = snapshotNativeNetwork(getNativeNetwork(networkId, options.registrations()));
    const timeout = Math.min(30_000, Math.max(options.timeoutMs ?? 12_000, Math.ceil(count / 4) * 6_000 + 4_000));
    return operation(networkId, address, signal, async (read, block, holder) => {
      const phase: PortfolioReadPhase = Object.freeze({ kind: 'portfolio' });
      portfolioPhases.set(phase, { network, holder, read, block, signal, check: () => { check(read.signal); guard(); } });
      try { return await work(phase); }
      finally { portfolioPhases.delete(phase); }
    }, { network, assertCurrent: guard }, true, timeout);
  };
}


class ScopedCallRpcError extends Error {
  readonly value: unknown;
  constructor(value: unknown) {
    super('EVM_CALL_FAILED');
    this.value = value;
  }
}
const SELECTORS = Object.freeze({
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  balanceOf: '0x70a08231',
});
const CODE_BYTES = 32 * 1024;
const fail = (code: Erc20ReadError['code']): never => {
  throw new Erc20ReadError(code);
};
const check = (signal: AbortSignal): void => {
  if (signal.aborted) fail('CANCELLED');
};


function word(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value))
    return fail('INVALID_RESPONSE');
  return BigInt(value);
}
function blockIdentity(
  value: unknown
): Readonly<{ number: string; hash: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('INVALID_RESPONSE');
  const block = value as Record<string, unknown>;
  if (typeof block.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(block.hash))
    return fail('INVALID_RESPONSE');
  try {
    return {
      number: `0x${parseRpcQuantity(block.number).toString(16)}`,
      hash: block.hash.toLowerCase(),
    };
  } catch {
    return fail('INVALID_RESPONSE');
  }
}
/** Admit the ABI offset and length before allocating or decoding string bytes. */
function textResult(value: unknown, field: 'name' | 'symbol'): string {
  const maximum = ERC20_TEXT_LIMITS[field].bytes;
  if (
    typeof value !== 'string' ||
    value.length > 2 + (64 + Math.ceil(maximum / 32) * 32) * 2 ||
    !/^0x[0-9a-fA-F]+$/.test(value) ||
    value.length < 130 ||
    (value.length - 2) % 64 !== 0
  )
    return fail('INVALID_RESPONSE');
  if (BigInt(`0x${value.slice(2, 66)}`) !== 32n)
    return fail('INVALID_RESPONSE');
  const length = BigInt(`0x${value.slice(66, 130)}`);
  if (length < 1n || length > BigInt(maximum)) return fail('INVALID_RESPONSE');
  const bytesLength = Number(length);
  const padded = Math.ceil(bytesLength / 32) * 32;
  if (
    value.length !== 2 + (64 + padded) * 2 ||
    !/^0*$/.test(value.slice(130 + bytesLength * 2))
  )
    return fail('INVALID_RESPONSE');
  const bytes = new Uint8Array(bytesLength);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(
      value.slice(130 + index * 2, 132 + index * 2),
      16
    );
  try {
    return parseErc20Text(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      field
    );
  } catch {
    return fail('INVALID_RESPONSE');
  }
}
function decimalsResult(value: unknown): number {
  try {
    return parseErc20Decimals(word(value));
  } catch {
    return fail('INVALID_RESPONSE');
  }
}
function unitsResult(value: unknown): string {
  try {
    return parseErc20Units(word(value));
  } catch {
    return fail('INVALID_RESPONSE');
  }
}
function codeResult(value: unknown): void {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length > 2 + CODE_BYTES * 2 ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)
  )
    fail('INVALID_RESPONSE');
}

/** Fixed read-only methods, bounded calls and one deadline per observation. */
function createReadOperation(options: ReadOptions, maximumCallBytes = 16 * 1024) {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error('Invalid RPC timeout');
  const capabilities = new Map<string, RpcReadCapabilities>();
  const boundedFetch = createBoundedRpcFetch(fetcher);

  async function operation<T>(
    networkId: EvmNetworkId,
    address: string,
    external: AbortSignal,
    work: (read: Read, block: string, holder: string) => Promise<T>,
    scope?: CapturedScope,
    batchedEnvelope = false,
    operationTimeoutMs = timeoutMs,
    phase?: PortfolioReadPhase
  ): Promise<T> {
    check(external);
    let network: ReturnType<typeof getNativeNetwork>;
    let holder: string;
    try {
      network =
        scope?.network ??
        getNativeNetwork(networkId, options.registrations?.());
      holder = normalizePublicAddress(address, networkId);
    } catch {
      return fail('INVALID_INPUT');
    }
    if (phase) return inPortfolioPhase(phase, network, holder, external, scope?.assertCurrent ?? (() => undefined), work);
    const controller = new AbortController();
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, operationTimeoutMs);
    const assertCurrent = () => {
      check(controller.signal);
      if (scope) {
        try {
          scope.assertCurrent();
        } catch {
          abort();
          fail('CANCELLED');
        }
        check(controller.signal);
      }
    };
    const capabilityKey = `${network.registrationHash}:${network.rpcUrl}`;
    let capability = capabilities.get(capabilityKey);
    if (!capability) {
      capability = new RpcReadCapabilities(network.rpcUrl);
      capabilities.set(capabilityKey, capability);
      if (capabilities.size > 16) capabilities.delete(capabilities.keys().next().value!);
    }
    const clients: JsonRpcReadClient[] = [];
    const createClient = (maxConcurrency = 4, rejectResponse = abort, lifetime = controller.signal) => {
      const client = new JsonRpcReadClient(network.rpcUrl, {
        capabilities: capability,
        signal: lifetime,
        timeoutMs: operationTimeoutMs,
        recoverResponse: false,
        maxConcurrency,
        maxBatchItems: 40,
        maxRequestBytes: 128 * 1024,
        maxResponseBytes: 512 * 1024,
        requestInit: {
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        },
        fetch: async (url, init) => {
          assertCurrent();
          if (url !== network.rpcUrl) return fail('WRONG_CHAIN');
          const response = await boundedFetch(url, init);
          try {
            assertCurrent();
            if (
              response.redirected ||
              (response.url && response.url !== network.rpcUrl)
            )
              return fail('WRONG_CHAIN');
            const contentType = response.headers.get('content-type');
            if (
              contentType &&
              !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
                contentType
              )
            )
              return fail('INVALID_RESPONSE');
            return response;
          } catch (error) {
            rejectResponse();
            try {
              await response.body?.cancel();
            } catch {
              /* Keep the primary refusal. */
            }
            throw error;
          }
        },
      });
      clients.push(client);
      return client;
    };
    const batch = createClient();
    const maximumFor = (method: Method) =>
      method === 'eth_getBlockByNumber'
        ? 512 * 1024
        : method === 'eth_getCode'
        ? CODE_BYTES * 2 + 512
        : maximumCallBytes;
    const makeRead = (
      childSignal = controller.signal,
      childTimeout = operationTimeoutMs,
      childAbort?: () => void,
      concurrency = 1
    ): Read => {
      const client = childAbort ? createClient(concurrency, childAbort, childSignal) : batch;
      const read = (async (
        method: Method,
        params: readonly unknown[],
        captureRpcError?: true
      ) => {
        assertCurrent();
        try {
          const value = await client.read(method, params, {
            signal: childSignal,
            timeoutMs: childTimeout,
            maxResponseBytes: maximumFor(method),
          });
          assertCurrent();
          return value;
        } catch (error) {
          if (controller.signal.aborted) return fail('CANCELLED');
          if (
            captureRpcError &&
            method === 'eth_call' &&
            error instanceof RpcReadError
          )
            throw new ScopedCallRpcError({
              code: error.code,
              message: error.message,
              data: error.data,
            });
          return fail('INVALID_RESPONSE');
        }
      }) as Read;
      read.many = async (requests) => {
        assertCurrent();
        const results = await client.readMany(requests, {
          signal: childSignal,
          timeoutMs: childTimeout,
        });
        assertCurrent();
        return results.map((result, index) => {
          if (
            result.status === 'fulfilled' &&
            new TextEncoder().encode(JSON.stringify(result.value)).byteLength >
              maximumFor(requests[index]!.method)
          )
            return {
              status: 'rejected' as const,
              reason: new Erc20ReadError('INVALID_RESPONSE'),
            };
          return result;
        });
      };
      read.signal = controller.signal;
      read.canBatch = () => capability!.getBatchLimit(40) > 1;
      read.scoped = (signal, timeout, cancel, concurrency) =>
        makeRead(signal, timeout, cancel, concurrency);
      return read;
    };
    const read = makeRead();
    const accepted = (result: PromiseSettledResult<unknown>) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    };
    try {
      const initial = batchedEnvelope
        ? await read.many([
            { method: 'eth_chainId', params: [] },
            { method: 'eth_getBlockByNumber', params: ['latest', false] },
          ])
        : null;
      let chain: bigint;
      try {
        chain = parseRpcQuantity(
          initial ? accepted(initial[0]!) : await read('eth_chainId', [])
        );
      } catch (cause) {
        if (cause instanceof Erc20ReadError) throw cause;
        return fail('INVALID_RESPONSE');
      }
      if (chain !== BigInt(network.chainId)) return fail('WRONG_CHAIN');
      const block = blockIdentity(
        initial
          ? accepted(initial[1]!)
          : await read('eth_getBlockByNumber', ['latest', false])
      );
      const result = await work(read, block.number, holder);
      const final = batchedEnvelope
        ? await read.many([
            { method: 'eth_getBlockByNumber', params: [block.number, false] },
            { method: 'eth_chainId', params: [] },
          ])
        : null;
      const finalBlock = blockIdentity(
        final
          ? accepted(final[0]!)
          : await read('eth_getBlockByNumber', [block.number, false])
      );
      if (finalBlock.number !== block.number || finalBlock.hash !== block.hash)
        return fail('INVALID_RESPONSE');
      try {
        chain = parseRpcQuantity(
          final ? accepted(final[1]!) : await read('eth_chainId', [])
        );
      } catch (cause) {
        if (cause instanceof Erc20ReadError) throw cause;
        return fail('INVALID_RESPONSE');
      }
      if (chain !== BigInt(network.chainId)) return fail('WRONG_CHAIN');
      assertCurrent();
      return result;
    } catch (cause) {
      if (controller.signal.aborted) return fail('CANCELLED');
      if (cause instanceof Erc20ReadError) throw cause;
      return fail('UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      external.removeEventListener('abort', abort);
      controller.abort();
      clients.forEach((client) => client.destroy());
    }
  }
  return operation;
}

function contract(value: unknown): string {
  try {
    return normalizeErc20Address(value);
  } catch {
    return fail('INVALID_INPUT');
  }
}

export function createErc20Reader(options: ReadOptions = {}): Erc20Reader {
  const operation = createReadOperation(options);
  const aggregateByNetwork = new Map<string, ReturnType<typeof createErc20BalanceBatch>>();
  const balanceData = (holder: string) =>
    `${SELECTORS.balanceOf}${holder.slice(2).toLowerCase().padStart(64, '0')}`;
  return Object.freeze({
    readToken: async (
      network: EvmNetworkId,
      address: string,
      contractAddress: string,
      signal: AbortSignal
    ) => {
      const selected = contract(contractAddress);
      return operation(
        network,
        address,
        signal,
        async (read, block, holder) => {
          codeResult(await read('eth_getCode', [selected, block]));
          const observations = await read.many(
            [SELECTORS.name, SELECTORS.symbol, SELECTORS.decimals, balanceData(holder)]
              .map(data => ({ method: 'eth_call', params: [{ to: selected, data }, block] }))
          );
          const values = observations.map(observation => {
            if (observation.status === 'rejected') throw observation.reason;
            return observation.value;
          });
          const name = textResult(values[0], 'name');
          const symbol = textResult(values[1], 'symbol');
          const decimals = decimalsResult(values[2]);
          const units = unitsResult(values[3]);
          return Object.freeze({
            metadata: parseErc20Metadata({
              contractAddress: selected,
              name,
              symbol,
              decimals,
            }),
            units,
          });
        },
        undefined,
        true
      );
    },
    readBalances: async (
      network: EvmNetworkId,
      address: string,
      tokens: readonly Erc20Metadata[],
      signal: AbortSignal,
      assertCurrent: () => void = () => undefined,
      phase?: PortfolioReadPhase
    ) => {
      if (!Array.isArray(tokens) || tokens.length > 256)
        return fail('INVALID_INPUT');
      let selected: Erc20Metadata[];
      try {
        selected = tokens.map(parseErc20Metadata);
      } catch {
        return fail('INVALID_INPUT');
      }
      if (!selected.length) return Object.freeze([]);
      const registration = getNativeNetwork(network, options.registrations?.());
      const key = `${registration.registrationHash}:${registration.rpcUrl}`;
      let aggregate = aggregateByNetwork.get(key);
      if (!aggregate) {
        aggregate = createErc20BalanceBatch();
        aggregateByNetwork.set(key, aggregate);
        if (aggregateByNetwork.size > 16) aggregateByNetwork.delete(aggregateByNetwork.keys().next().value!);
      }
      const timeout = Math.min(
        30_000,
        Math.max(
          options.timeoutMs ?? 12_000,
          Math.ceil(selected.length / 4) * 6_000 + 4_000
        )
      );
      const workDeadline = Date.now() + timeout - 2_000;
      return operation(
        network,
        address,
        signal,
        async (read, block, holder) => {
          const calls = selected.flatMap((token) => [
            { target: token.contractAddress, data: SELECTORS.decimals },
            { target: token.contractAddress, data: balanceData(holder) },
          ]);
          const requests = calls.map((call) => ({
            method: 'eth_call' as const,
            params: [{ to: call.target, data: call.data }, block],
          }));
          // Token work expires before the shared canonical checks. Scalar-only
          // endpoints give each token its own lifetime, so one stalled getter
          // cannot consume the healthy tokens' observation budget.
          const scoped = async <T>(
            work: (scopedRead: Read) => Promise<T>,
            concurrency = 1
          ) => {
            const remaining = Math.min(6_000, workDeadline - Date.now());
            if (remaining <= 0) return fail('UNAVAILABLE');
            const controller = new AbortController();
            const cancel = () => controller.abort();
            read.signal.addEventListener('abort', cancel, { once: true });
            if (read.signal.aborted) cancel();
            const timer = setTimeout(cancel, remaining);
            try {
              return await work(
                read.scoped(controller.signal, remaining, cancel, concurrency)
              );
            } finally {
              clearTimeout(timer);
              read.signal.removeEventListener('abort', cancel);
              controller.abort();
            }
          };
          const readDirect = async (direct: readonly ReadRequest[]) => {
            if (read.canBatch()) return scoped(groupRead => groupRead.many(direct), 4);
            const results: PromiseSettledResult<unknown>[] = new Array(direct.length);
            let next = 0;
            const worker = async () => {
              while (next < direct.length) {
                const index = next;
                next += 2;
                try {
                  const values = await scoped(groupRead => groupRead.many(direct.slice(index, index + 2)));
                  results[index] = values[0]!;
                  if (index + 1 < direct.length) results[index + 1] = values[1]!;
                } catch (reason) {
                  check(read.signal);
                  results[index] = { status: 'rejected', reason };
                  if (index + 1 < direct.length) results[index + 1] = { status: 'rejected', reason };
                }
              }
            };
            await Promise.all(Array.from({ length: Math.min(4, Math.ceil(direct.length / 2)) }, worker));
            return results;
          };
          let observations: PromiseSettledResult<unknown>[];
          try {
            observations = selected.length > 1
              ? await scoped(groupRead => aggregate!({ read: groupRead, readMany: groupRead.many, readDirect }, calls, block), 4)
              : await readDirect(requests);
          } catch {
            check(read.signal);
            observations = await readDirect(requests);
          }
          return Object.freeze(
            selected.map((token, index): Erc20BalanceResult => {
              const precision = observations[index * 2]!;
              const balance = observations[index * 2 + 1]!;
              try {
                if (
                  precision.status !== 'fulfilled' ||
                  balance.status !== 'fulfilled'
                )
                  return Object.freeze({ status: 'error', units: null });
                return Object.freeze({
                  status: 'available',
                  units: parseErc20BalancePair(precision.value, balance.value, token.decimals),
                });
              } catch {
                return Object.freeze({ status: 'error', units: null });
              }
            })
          );
        },
        { network: registration, assertCurrent },
        true,
        timeout,
        phase
      );
    },
    readBalance: async (
      network: EvmNetworkId,
      address: string,
      token: Erc20Metadata,
      signal: AbortSignal
    ) => {
      let selected: Erc20Metadata;
      try {
        selected = parseErc20Metadata(token);
      } catch {
        return fail('INVALID_INPUT');
      }
      return operation(
        network,
        address,
        signal,
        async (read, block, holder) => {
          const [precision, balance] = await read.many([
            { method: 'eth_call', params: [{ to: selected.contractAddress, data: SELECTORS.decimals }, block] },
            { method: 'eth_call', params: [{ to: selected.contractAddress, data: balanceData(holder) }, block] },
          ]);
          if (!precision || !balance) return fail('INVALID_RESPONSE');
          if (precision.status === 'rejected') throw precision.reason;
          if (balance.status === 'rejected') throw balance.reason;
          const decimals = decimalsResult(precision.value);
          const units = unitsResult(balance.value);
          if (decimals !== selected.decimals) return fail('CHANGED_PRECISION');
          return Object.freeze({ units });
        },
        undefined,
        true
      );
    },
  });
}

type SelectedNftReadOptions = Required<
  Pick<ReadOptions, 'fetch' | 'registrations'>
> &
  Pick<ReadOptions, 'timeoutMs'>;
export type ScopedCallOutcome =
  | Readonly<{ kind: 'result'; data: string }>
  | Readonly<{ kind: 'rpc-error'; error: unknown }>;

type NftPortfolioCall = ((data: string) => Promise<ScopedCallOutcome>) & {
  many(data: readonly string[]): Promise<ScopedCallOutcome[]>;
};

/** One anchored observation; each collection owns a shorter cancellable read budget. */
export function createSelectedNftPortfolioReadOperation(options: SelectedNftReadOptions) {
  const operation = createReadOperation(options, 32 * 1024);
  return async <T>(
    networkId: EvmNetworkId,
    owner: string,
    addresses: readonly string[],
    signal: AbortSignal,
    guard: () => void,
    work: (
      scope: Readonly<{
        holder: string;
        withContract<V>(
          target: string,
          work: (call: NftPortfolioCall) => Promise<V>
        ): Promise<V>;
      }>
    ) => Promise<T>,
    phase?: PortfolioReadPhase
  ): Promise<T> => {
    if (!addresses.length || addresses.length > 256)
      return fail('INVALID_INPUT');
    const targets = new Set(addresses.map(contract));
    const network = snapshotNativeNetwork(getNativeNetwork(networkId, options.registrations()));
    const timeout = Math.min(
      30_000,
      Math.max(
        options.timeoutMs ?? 12_000,
        Math.ceil(addresses.length / 4) * 6_000 + 4_000
      )
    );
    const workDeadline = Date.now() + timeout - 2_000;
    const assertCurrent = () => {
      const result: unknown = guard();
      if (result !== undefined) {
        if (
          result &&
          (typeof result === 'object' || typeof result === 'function')
        )
          void Promise.resolve(result).catch(() => undefined);
        fail('CANCELLED');
      }
      if (snapshotNativeNetwork(getNativeNetwork(networkId, options.registrations())).registrationHash !== network.registrationHash)
        fail('CANCELLED');
    };
    return operation(
      networkId,
      owner,
      signal,
      async (read, block, holder) => {
        let calls = 0;
        return work({
          holder,
          async withContract(target, work) {
            target = contract(target);
            const remaining = Math.min(6_000, workDeadline - Date.now());
            if (!targets.has(target) || remaining <= 0)
              return fail('UNAVAILABLE');
            const controller = new AbortController();
            const cancel = () => controller.abort();
            read.signal.addEventListener('abort', cancel, { once: true });
            if (read.signal.aborted) cancel();
            const timer = setTimeout(cancel, remaining);
            const groupRead = read.scoped(controller.signal, remaining, () =>
              controller.abort()
            );
            const validateData = (data: string) => {
              if (
                ++calls > addresses.length * 3 ||
                typeof data !== 'string' ||
                data.length < 10 ||
                data.length > 34000 ||
                !/^0x(?:[0-9a-fA-F]{2})+$/.test(data)
              )
                return fail('INVALID_INPUT');
            };
            let code: Promise<void> | undefined;
            const call = Object.assign(
              async (data: string): Promise<ScopedCallOutcome> => {
                validateData(data);
                code ??= groupRead('eth_getCode', [target, block]).then(
                  codeResult
                );
                await code;
                try {
                  const value = await groupRead(
                    'eth_call',
                    [{ to: target, data }, block],
                    true
                  );
                  if (
                    typeof value !== 'string' ||
                    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)
                  )
                    return fail('INVALID_RESPONSE');
                  return { kind: 'result', data: value };
                } catch (error) {
                  if (error instanceof ScopedCallRpcError)
                    return { kind: 'rpc-error', error: error.value };
                  throw error;
                }
              },
              {
                many: async (
                  data: readonly string[]
                ): Promise<ScopedCallOutcome[]> => {
                  data.forEach(validateData);
                  const values = await groupRead.many([
                    { method: 'eth_getCode', params: [target, block] },
                    ...data.map((value) => ({
                      method: 'eth_call' as const,
                      params: [{ to: target, data: value }, block],
                    })),
                  ]);
                  const first = values[0];
                  if (!first || first.status === 'rejected')
                    throw first?.status === 'rejected'
                      ? first.reason
                      : new Error('Missing collection code');
                  codeResult(first.value);
                  return values.slice(1).map((value) => {
                    if (value.status === 'rejected')
                      return {
                        kind: 'rpc-error' as const,
                        error: value.reason,
                      };
                    if (
                      typeof value.value !== 'string' ||
                      !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.value)
                    )
                      return fail('INVALID_RESPONSE');
                    return { kind: 'result' as const, data: value.value };
                  });
                },
              }
            );
            try {
              return await work(call);
            } finally {
              clearTimeout(timer);
              read.signal.removeEventListener('abort', cancel);
              controller.abort();
            }
          },
        });
      },
      { network, assertCurrent },
      true,
      timeout,
      phase
    );
  };
}

/** Internal host seam with one selected contract and no caller-supplied block or RPC method. */
export function createSelectedNftReadOperation(
  options: SelectedNftReadOptions
) {
  return createSelectedContractReadOperation(options, 2);
}

/** One enumeration probe, one balance and at most ten owner-index reads. */
export function createSelectedNftEnumerationReadOperation(
  options: SelectedNftReadOptions
) {
  return createSelectedContractReadOperation(options, 12);
}

/** Contract-type and metadata observation only; ownership keeps its two-call boundary. */
export function createSelectedAssetReadOperation(
  options: SelectedNftReadOptions
) {
  return createSelectedContractReadOperation(options, 8);
}

export function parseScopedErc20Metadata(
  contractAddress: string,
  name: unknown,
  symbol: unknown,
  decimals: unknown,
  balance: unknown
): Erc20Metadata {
  unitsResult(balance);
  return parseErc20Metadata({
    contractAddress,
    name: textResult(name, 'name'),
    symbol: textResult(symbol, 'symbol'),
    decimals: decimalsResult(decimals),
  });
}

function createSelectedContractReadOperation(
  options: SelectedNftReadOptions,
  maximumCalls: 2 | 8 | 12
) {
  const { registrations } = options;
  if (
    typeof options.fetch !== 'function' ||
    typeof registrations !== 'function'
  )
    throw new Error('NFT read host required');
  const operation = createReadOperation(options);
  return async <T>(
    networkId: EvmNetworkId,
    owner: string,
    contractAddress: string,
    signal: AbortSignal,
    guard: () => void,
    work: (
      scope: Readonly<{
        holder: string;
        target: string;
        call(data: string): Promise<ScopedCallOutcome>;
      }>
    ) => Promise<T>
  ): Promise<T> => {
    check(signal);
    const target = contract(contractAddress);
    const registered = () => {
      const list = registrations();
      if (!list) return fail('INVALID_INPUT');
      return getNativeNetwork(networkId, list);
    };
    let initial: NativeNetworkRegistration;
    let network: NativeNetworkRegistration;
    try {
      initial = registered();
      network = snapshotNativeNetwork(initial);
    } catch {
      return fail('INVALID_INPUT');
    }
    const assertCurrent = () => {
      const result: unknown = guard();
      if (result !== undefined) {
        if (
          result &&
          (typeof result === 'object' || typeof result === 'function')
        )
          void Promise.resolve(result).catch(() => undefined);
        fail('CANCELLED');
      }
      const latest = registered();
      if (latest === initial && Object.isFrozen(initial)) return;
      if (
        snapshotNativeNetwork(latest).registrationHash !==
        network.registrationHash
      )
        fail('CANCELLED');
    };
    return operation(
      networkId,
      owner,
      signal,
      async (read, block, holder) => {
        codeResult(await read('eth_getCode', [target, block]));
        let calls = 0;
        let pending: {
          data: string;
          resolve(value: ScopedCallOutcome): void;
          reject(error: unknown): void;
        }[] = [];
        const flush = async () => {
          const batch = pending;
          pending = [];
          try {
            const results = await read.many(batch.map(({ data }) => ({
              method: 'eth_call', params: [{ to: target, data }, block],
            })));
            for (const [index, job] of batch.entries()) {
              const result = results[index];
              if (!result) job.reject(new Erc20ReadError('INVALID_RESPONSE'));
              else if (result.status === 'rejected') {
                const error = result.reason;
                if (error instanceof RpcReadError) job.resolve({ kind: 'rpc-error', error: {
                  code: error.code, message: error.message, data: error.data,
                } });
                else job.reject(error);
              } else if (typeof result.value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result.value))
                job.reject(new Erc20ReadError('INVALID_RESPONSE'));
              else job.resolve({ kind: 'result', data: result.value });
            }
          } catch (error) {
            batch.forEach(job => job.reject(error));
          }
        };
        return work({
          holder,
          target,
          async call(data) {
            if (++calls > maximumCalls) return fail('INVALID_RESPONSE');
            if (
              typeof data !== 'string' ||
              data.length < 10 ||
              data.length > 1026 ||
              !/^0x(?:[0-9a-fA-F]{2})+$/.test(data)
            )
              return fail('INVALID_INPUT');
            return new Promise<ScopedCallOutcome>((resolve, reject) => {
              pending.push({ data, resolve, reject });
              if (pending.length === 1) void Promise.resolve().then(flush);
            });
          },
        });
      },
      { network, assertCurrent },
      true
    );
  };
}
