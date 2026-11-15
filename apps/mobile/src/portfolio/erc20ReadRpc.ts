import { createBoundedRpcFetch } from '../custody/boundedRpcFetch.ts';
import { createErc20BalanceBatch } from '../../../../source/shared/erc20BalanceBatch.ts';
import {
  ERC20_TEXT_LIMITS,
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
    assertCurrent?: () => void
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
};
type CapturedScope = Readonly<{
  network: NativeNetworkRegistration;
  assertCurrent(): void;
}>;

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
    batchedEnvelope = false
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
    const controller = new AbortController();
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
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
    const batch = new JsonRpcReadClient(network.rpcUrl, {
      capabilities: capability,
      signal: controller.signal,
      timeoutMs,
      recoverResponse: false,
      maxConcurrency: 4,
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
          if (response.redirected || (response.url && response.url !== network.rpcUrl))
            return fail('WRONG_CHAIN');
          const contentType = response.headers.get('content-type');
          if (contentType && !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType))
            return fail('INVALID_RESPONSE');
          return response;
        } catch (error) {
          abort();
          try { await response.body?.cancel(); } catch { /* Keep the primary refusal. */ }
          throw error;
        }
      },
    });
    const maximumFor = (method: Method) =>
      method === 'eth_getBlockByNumber'
        ? 512 * 1024
        : method === 'eth_getCode'
        ? CODE_BYTES * 2 + 512
        : maximumCallBytes;
    const read = (async (
      method: Method,
      params: readonly unknown[],
      captureRpcError?: true
    ) => {
      assertCurrent();
      try {
        const value = await batch.read(method, params, {
          signal: controller.signal,
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
      const results = await batch.readMany(requests, {
        signal: controller.signal,
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
      batch.destroy();
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
  const call = (read: Read, address: string, data: string, block: string) =>
    read('eth_call', [{ to: address, data }, block]);
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
          const [name, symbol, decimals, units] = await Promise.all([
            call(read, selected, SELECTORS.name, block).then((value) =>
              textResult(value, 'name')
            ),
            call(read, selected, SELECTORS.symbol, block).then((value) =>
              textResult(value, 'symbol')
            ),
            call(read, selected, SELECTORS.decimals, block).then(
              decimalsResult
            ),
            call(read, selected, balanceData(holder), block).then(unitsResult),
          ]);
          return Object.freeze({
            metadata: parseErc20Metadata({
              contractAddress: selected,
              name,
              symbol,
              decimals,
            }),
            units,
          });
        }
      );
    },
    readBalances: async (
      network: EvmNetworkId,
      address: string,
      tokens: readonly Erc20Metadata[],
      signal: AbortSignal,
      assertCurrent: () => void = () => undefined
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
          const observations = selected.length > 1
            ? await aggregate!({ read, readMany: read.many }, calls, block)
            : await read.many(requests);
          return Object.freeze(
            selected.map((token, index): Erc20BalanceResult => {
              const precision = observations[index * 2]!;
              const balance = observations[index * 2 + 1]!;
              try {
                if (
                  precision.status !== 'fulfilled' ||
                  balance.status !== 'fulfilled' ||
                  decimalsResult(precision.value) !== token.decimals
                )
                  return Object.freeze({ status: 'error', units: null });
                return Object.freeze({
                  status: 'available',
                  units: unitsResult(balance.value),
                });
              } catch {
                return Object.freeze({ status: 'error', units: null });
              }
            })
          );
        },
        { network: registration, assertCurrent },
        true
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

/** One anchored selected-account observation for bounded saved NFT groups. */
export function createSelectedNftPortfolioReadOperation(options: SelectedNftReadOptions) {
  // A 256-item balanceOfBatch result includes two ABI header words.
  const operation = createReadOperation(options, 32 * 1024);
  return async <T>(networkId: EvmNetworkId, owner: string, addresses: readonly string[], signal: AbortSignal,
    guard: () => void, work: (scope: Readonly<{ holder: string; call(target: string, data: string): Promise<ScopedCallOutcome> }>) => Promise<T>): Promise<T> => {
    if (!addresses.length || addresses.length > 256) return fail('INVALID_INPUT');
    const targets = new Set(addresses.map(contract));
    const network = snapshotNativeNetwork(getNativeNetwork(networkId, options.registrations()));
    const assertCurrent = () => {
      const result: unknown = guard();
      if (result !== undefined) {
        if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
        fail('CANCELLED');
      }
      if (snapshotNativeNetwork(getNativeNetwork(networkId, options.registrations())).registrationHash !== network.registrationHash)
        fail('CANCELLED');
    };
    return operation(networkId, owner, signal, async (read, block, holder) => {
      const codes = new Map<string, Promise<void>>();
      let calls = 0;
      return work({ holder, async call(target, data) {
        target = contract(target);
        if (!targets.has(target) || ++calls > addresses.length * 3 || typeof data !== 'string' ||
            data.length < 10 || data.length > 34000 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(data)) return fail('INVALID_INPUT');
        let code = codes.get(target);
        if (!code) { code = read('eth_getCode', [target, block]).then(codeResult); codes.set(target, code); }
        await code;
        try {
          const value = await read('eth_call', [{ to: target, data }, block], true);
          if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) return fail('INVALID_RESPONSE');
          return { kind: 'result', data: value };
        } catch (error) {
          if (error instanceof ScopedCallRpcError) return { kind: 'rpc-error', error: error.value };
          throw error;
        }
      } });
    }, { network, assertCurrent }, true);
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
            try {
              const value = await read(
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
        });
      },
      { network, assertCurrent }
    );
  };
}
