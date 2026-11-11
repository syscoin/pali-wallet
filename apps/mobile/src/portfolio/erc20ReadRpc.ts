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
import { boundedResponseText, parseRpcQuantity } from '../platformRpc.ts';

export type { Erc20Metadata } from '../../../../source/shared/erc20.ts';
export interface Erc20Reader {
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
type Read = (
  method: Method,
  params: readonly unknown[],
  captureRpcError?: true
) => Promise<unknown>;
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

function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(new Erc20ReadError('CANCELLED'));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Erc20ReadError('CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
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
function createReadOperation(options: ReadOptions) {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error('Invalid RPC timeout');
  let sequence = 0;
  let active = 0;
  const waiting: { signal: AbortSignal; admit(): void; abort(): void }[] = [];
  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next.admit();
  };
  async function acquire(signal: AbortSignal): Promise<() => void> {
    check(signal);
    if (active < 4) {
      active++;
      return release;
    }
    if (waiting.length >= 16) return fail('UNAVAILABLE');
    await new Promise<void>((resolve, reject) => {
      const ticket = {
        signal,
        admit() {
          signal.removeEventListener('abort', ticket.abort);
          active++;
          resolve();
        },
        abort() {
          const index = waiting.indexOf(ticket);
          if (index >= 0) waiting.splice(index, 1);
          signal.removeEventListener('abort', ticket.abort);
          reject(new Erc20ReadError('CANCELLED'));
        },
      };
      waiting.push(ticket);
      signal.addEventListener('abort', ticket.abort, { once: true });
    });
    return release;
  }

  async function operation<T>(
    networkId: EvmNetworkId,
    address: string,
    external: AbortSignal,
    work: (read: Read, block: string, holder: string) => Promise<T>,
    scope?: CapturedScope
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
    const read: Read = async (method, params, captureRpcError) => {
      assertCurrent();
      if (
        ![
          'eth_chainId',
          'eth_getBlockByNumber',
          'eth_getCode',
          'eth_call',
        ].includes(method)
      )
        return fail('INVALID_INPUT');
      const done = await acquire(controller.signal);
      try {
        assertCurrent();
        const id = ++sequence;
        if (!Number.isSafeInteger(id)) return fail('UNAVAILABLE');
        const response = await cancellable(
          fetcher(network.rpcUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
            signal: controller.signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
          }),
          controller.signal
        );
        assertCurrent();
        if (!response.ok) return fail('UNAVAILABLE');
        const contentType = response.headers.get('content-type');
        if (
          contentType &&
          !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
            contentType
          )
        )
          return fail('INVALID_RESPONSE');
        let body: string;
        try {
          body = await cancellable(
            boundedResponseText(
              response,
              controller.signal,
              method === 'eth_getBlockByNumber'
                ? 512 * 1024
                : method === 'eth_getCode'
                ? CODE_BYTES * 2 + 512
                : 16 * 1024
            ),
            controller.signal
          );
        } catch {
          check(controller.signal);
          return fail('INVALID_RESPONSE');
        }
        assertCurrent();
        let decoded: unknown;
        try {
          decoded = JSON.parse(body);
        } catch {
          return fail('INVALID_RESPONSE');
        }
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
          return fail('INVALID_RESPONSE');
        const result = decoded as Record<string, unknown>;
        if (result.jsonrpc !== '2.0' || result.id !== id)
          return fail('INVALID_RESPONSE');
        const hasResult = Object.hasOwn(result, 'result');
        if (Object.hasOwn(result, 'error')) {
          if (captureRpcError && method === 'eth_call' && !hasResult)
            throw new ScopedCallRpcError(result.error);
          return fail('INVALID_RESPONSE');
        }
        if (!hasResult) return fail('INVALID_RESPONSE');
        return result.result;
      } finally {
        done();
      }
    };
    try {
      let chain: bigint;
      try {
        chain = parseRpcQuantity(await read('eth_chainId', []));
      } catch (cause) {
        if (cause instanceof Erc20ReadError) throw cause;
        return fail('INVALID_RESPONSE');
      }
      if (chain !== BigInt(network.chainId)) return fail('WRONG_CHAIN');
      const block = blockIdentity(
        await read('eth_getBlockByNumber', ['latest', false])
      );
      const result = await work(read, block.number, holder);
      const finalBlock = blockIdentity(
        await read('eth_getBlockByNumber', [block.number, false])
      );
      if (finalBlock.number !== block.number || finalBlock.hash !== block.hash)
        return fail('INVALID_RESPONSE');
      try {
        chain = parseRpcQuantity(await read('eth_chainId', []));
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
          const [decimals, units] = await Promise.all([
            call(
              read,
              selected.contractAddress,
              SELECTORS.decimals,
              block
            ).then(decimalsResult),
            call(
              read,
              selected.contractAddress,
              balanceData(holder),
              block
            ).then(unitsResult),
          ]);
          if (decimals !== selected.decimals) return fail('CHANGED_PRECISION');
          return Object.freeze({ units });
        }
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
