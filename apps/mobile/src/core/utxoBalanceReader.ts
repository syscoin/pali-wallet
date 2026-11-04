import { boundedResponseText, ResponseSizeLimitError } from '../platformRpc.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { getUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

const MAX_RESPONSE_BYTES = 32 * 1024;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type UtxoBalanceErrorCode = 'INVALID_INPUT' | 'NETWORK_MISMATCH' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'CANCELLED';
export class UtxoBalanceError extends Error {
  readonly code: UtxoBalanceErrorCode;
  constructor(code: UtxoBalanceErrorCode) {
    super(code === 'CANCELLED' ? 'UTXO balance request was cancelled or timed out' : 'UTXO balance is unavailable');
    this.name = 'UtxoBalanceError';
    this.code = code;
  }
}
export type UtxoBalance = Readonly<{
  networkId: UtxoNetworkId;
  kind: 'utxo';
  chainId: 0 | 57;
  genesisHash: string;
  confirmedUnits: string;
  pendingDeltaUnits: string;
  unconfirmedTransactions: number;
  observedHeight: number;
}>;

function fail(code: UtxoBalanceErrorCode): never { throw new UtxoBalanceError(code); }
function check(signal: AbortSignal): void { if (signal.aborted) fail('CANCELLED'); }
export interface UtxoBalanceReader {
  readBalance(networkId: UtxoNetworkId, address: string, signal: AbortSignal): Promise<UtxoBalance>;
}

function object(value: unknown, allowEmptyError = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_RESPONSE');
  const result = value as Record<string, unknown>;
  if (Object.hasOwn(result, 'error') && (!allowEmptyError || result.error !== '')) return fail('INVALID_RESPONSE');
  return result;
}
function unsignedInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail('INVALID_RESPONSE');
  return value as number;
}
function units(value: unknown, signed: boolean): string {
  // Bounded canonical decimal strings, never lossy JSON numbers or exponents.
  if (typeof value !== 'string' || !(signed ? /^(?:0|-?[1-9][0-9]{0,77})$/ : /^(?:0|[1-9][0-9]{0,77})$/).test(value))
    return fail('INVALID_RESPONSE');
  return value;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  check(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new UtxoBalanceError('CANCELLED')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function discard(response: Response): void {
  try { void response.body?.cancel().catch(() => undefined); } catch { /* Best effort. */ }
}
function statusIdentity(value: unknown, network: UtxoNetwork): number {
  const root = object(value);
  const blockbook = object(root.blockbook);
  const backend = object(root.backend, true);
  if (blockbook.coin !== network.blockbookCoin || blockbook.network !== network.symbol ||
      blockbook.decimals !== network.decimals || backend.chain !== network.backendChain)
    return fail('NETWORK_MISMATCH');
  if (blockbook.initialSync !== false || blockbook.inSync !== true || blockbook.inSyncMempool !== true)
    return fail('UNAVAILABLE');
  return unsignedInteger(blockbook.bestHeight);
}

/**
 * Advisory indexer data for one public address. No cache, wallet state, keys,
 * transaction construction or broadcasting. All three reads share one deadline.
 */
export function createUtxoBalanceReader(options: Readonly<{ fetch: FetchLike; timeoutMs?: number }>): UtxoBalanceReader {
  // Ambient React Native fetch does not enforce redirect rejection. A host must
  // explicitly supply a qualified port before this reader can disclose addresses.
  const port = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'fetch') : undefined;
  if (!port || !('value' in port) || typeof port.value !== 'function') throw new Error('An explicit UTXO fetch port is required');
  const fetcher: FetchLike = port.value;
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error('Invalid UTXO balance timeout');
  return Object.freeze({
    async readBalance(networkId: UtxoNetworkId, address: string, externalSignal: AbortSignal): Promise<UtxoBalance> {
      check(externalSignal);
      let network: UtxoNetwork;
      let canonicalAddress: string;
      try {
        network = getUtxoNetwork(networkId);
        canonicalAddress = normalizeUtxoAddress(address, networkId);
      } catch { return fail('INVALID_INPUT'); }
      const controller = new AbortController();
      const abort = () => controller.abort();
      externalSignal.addEventListener('abort', abort, { once: true });
      if (externalSignal.aborted) controller.abort();
      const timer = setTimeout(abort, timeoutMs);
      async function read(path: string): Promise<unknown> {
        check(controller.signal);
        const url = network.endpoint + path;
        const request = Promise.resolve().then(() => {
          check(controller.signal);
          return fetcher(url, {
            method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal,
            credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
          });
        }).then((response) => {
          if (controller.signal.aborted) discard(response);
          check(controller.signal);
          return response;
        });
        const response = await abortable(request, controller.signal);
        check(controller.signal);
        if (!response.ok) { discard(response); return fail('UNAVAILABLE'); }
        if (response.redirected || response.url && response.url !== url) { discard(response); return fail('NETWORK_MISMATCH'); }
        const contentType = response.headers.get('content-type');
        if (contentType && !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType)) {
          discard(response); return fail('INVALID_RESPONSE');
        }
        const text = await boundedResponseText(response, controller.signal, MAX_RESPONSE_BYTES);
        check(controller.signal);
        try { return JSON.parse(text); } catch { return fail('INVALID_RESPONSE'); }
      }
      try {
        // No address is sent before metadata AND height-zero identity agree.
        const observedHeight = statusIdentity(await read('/api/'), network);
        const genesis = object(await read('/api/v2/block-index/0'));
        if (genesis.blockHash !== network.genesisHash) return fail('NETWORK_MISMATCH');
        // Basic omits pending amounts in the reviewed Blockbook source. Tokens
        // is the smallest level computing them; any asset output is ignored and
        // the entire response is bounded. This does not add token support.
        const summary = object(await read(`/api/v2/address/${encodeURIComponent(canonicalAddress)}?details=tokens`));
        if (summary.address !== canonicalAddress) return fail('INVALID_RESPONSE');
        const confirmedUnits = units(summary.balance, false);
        const pendingDeltaUnits = units(summary.unconfirmedBalance, true);
        const unconfirmedTransactions = unsignedInteger(summary.unconfirmedTxs);
        check(controller.signal);
        return Object.freeze({ networkId: network.id, kind: 'utxo', chainId: network.chainId,
          genesisHash: network.genesisHash, confirmedUnits, pendingDeltaUnits, unconfirmedTransactions, observedHeight });
      } catch (cause) {
        if (controller.signal.aborted) return fail('CANCELLED');
        if (cause instanceof UtxoBalanceError) throw cause;
        if (cause instanceof ResponseSizeLimitError) return fail('RESPONSE_TOO_LARGE');
        return fail('UNAVAILABLE');
      } finally {
        controller.abort();
        clearTimeout(timer);
        externalSignal.removeEventListener('abort', abort);
      }
    },
  });
}
