import { boundedResponseText, ResponseSizeLimitError } from '../platformRpc.ts';
import { getUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

export type UtxoFetch = (url: string, init: RequestInit) => Promise<Response>;
export type UtxoBalanceErrorCode = 'INVALID_INPUT' | 'NETWORK_MISMATCH' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'CANCELLED';
export class UtxoBalanceError extends Error {
  readonly code: UtxoBalanceErrorCode;
  constructor(code: UtxoBalanceErrorCode) {
    super(code === 'CANCELLED' ? 'UTXO balance request was cancelled or timed out' : 'UTXO balance is unavailable');
    this.name = 'UtxoBalanceError'; this.code = code;
  }
}
export function utxoFailure(code: UtxoBalanceErrorCode): never { throw new UtxoBalanceError(code); }
export function utxoObject(value: unknown, allowEmptyError = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return utxoFailure('INVALID_RESPONSE');
  const result = value as Record<string, unknown>;
  if (Object.hasOwn(result, 'error') && (!allowEmptyError || result.error !== '')) return utxoFailure('INVALID_RESPONSE');
  return result;
}
export function utxoCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return utxoFailure('INVALID_RESPONSE');
  return value as number;
}
export function utxoUnits(value: unknown, signed: boolean): string {
  if (typeof value !== 'string' || !(signed ? /^(?:0|-?[1-9][0-9]{0,77})$/ : /^(?:0|[1-9][0-9]{0,77})$/).test(value)) return utxoFailure('INVALID_RESPONSE');
  return value;
}
function statusIdentity(value: unknown, network: UtxoNetwork): number {
  const root = utxoObject(value), blockbook = utxoObject(root.blockbook), backend = utxoObject(root.backend, true);
  if (blockbook.coin !== network.blockbookCoin || blockbook.network !== network.symbol || blockbook.decimals !== network.decimals || backend.chain !== network.backendChain)
    return utxoFailure('NETWORK_MISMATCH');
  if (blockbook.initialSync !== false || blockbook.inSync !== true || blockbook.inSyncMempool !== true) return utxoFailure('UNAVAILABLE');
  return utxoCount(blockbook.bestHeight);
}
export function utxoFetchOptions(options: Readonly<{ fetch: UtxoFetch; timeoutMs?: number }>, defaultTimeout = 12000) {
  const port = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'fetch') : undefined;
  if (!port || !('value' in port) || typeof port.value !== 'function') throw new Error('An explicit UTXO fetch port is required');
  const timeoutMs = options.timeoutMs ?? defaultTimeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid UTXO balance timeout');
  return { fetch: port.value as UtxoFetch, timeoutMs };
}
export interface UtxoReadSession {
  readonly network: UtxoNetwork;
  readonly observedHeight: number;
  readonly anchorHash: string | null;
  read(path: string, retryUnavailable?: boolean): Promise<unknown>;
  verifyAnchor(): Promise<number>;
  consumedBytes(): number;
  close(): void;
}

/** Shared bounded transport boundary. No address is disclosed during opening. */
export async function openUtxoReadSession(networkId: UtxoNetworkId, options: Readonly<{ fetch: UtxoFetch; timeoutMs: number }>, external: AbortSignal,
  sampled = false, totalBytes = Number.MAX_SAFE_INTEGER, responseBytes = 32768): Promise<UtxoReadSession> {
  if (!Number.isSafeInteger(responseBytes) || responseBytes < 1 || responseBytes > 1024 * 1024) return utxoFailure('INVALID_INPUT');
  let network: UtxoNetwork;
  try { network = getUtxoNetwork(networkId); } catch { return utxoFailure('INVALID_INPUT'); }
  if (external.aborted) return utxoFailure('CANCELLED');
  const controller = new AbortController(); let failure: UtxoBalanceError | null = null, consumed = 0;
  const abort = () => controller.abort(); external.addEventListener('abort', abort, { once: true });
  if (external.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs);
  const close = () => { controller.abort(); clearTimeout(timer); external.removeEventListener('abort', abort); };
  const check = () => { if (failure) throw failure; if (controller.signal.aborted) return utxoFailure('CANCELLED'); };
  const charge = (bytes: number) => { if (bytes > totalBytes - consumed) throw new ResponseSizeLimitError(); consumed += bytes; };
  async function read(path: string, retryUnavailable = false): Promise<unknown> {
    try {
      check();
      const url = network.endpoint + path;
      const pending = Promise.resolve().then(() => { check(); return options.fetch(url, {
        method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal,
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      }); }).then((response) => {
        if (controller.signal.aborted) { try { void response.body?.cancel().catch(() => undefined); } catch { /* Best effort. */ } }
        check(); return response;
      });
      const response = await new Promise<Response>((resolve, reject) => {
        const stopped = () => reject(failure ?? new UtxoBalanceError('CANCELLED'));
        controller.signal.addEventListener('abort', stopped, { once: true });
        pending.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', stopped));
        if (controller.signal.aborted) stopped();
      });
      check();
      const discard = () => { try { void response.body?.cancel().catch(() => undefined); } catch { /* Best effort. */ } };
      if (!response.ok) { discard(); return utxoFailure('UNAVAILABLE'); }
      if (response.redirected || response.url && response.url !== url) { discard(); return utxoFailure('NETWORK_MISMATCH'); }
      const contentType = response.headers.get('content-type');
      if (contentType && !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType)) { discard(); return utxoFailure('INVALID_RESPONSE'); }
      const text = await boundedResponseText(response, controller.signal, responseBytes, charge); check();
      try { return JSON.parse(text); } catch { return utxoFailure('INVALID_RESPONSE'); }
    } catch (cause) {
      const currentFailure = controller.signal.aborted ? new UtxoBalanceError('CANCELLED') : cause instanceof UtxoBalanceError ? cause
        : new UtxoBalanceError(cause instanceof ResponseSizeLimitError ? 'RESPONSE_TOO_LARGE' : 'UNAVAILABLE');
      // A history reader may use the extension's explicit txslight fallback.
      // Chain, body, timeout and cancellation failures still poison the session.
      if (retryUnavailable && currentFailure.code === 'UNAVAILABLE') throw currentFailure;
      failure ??= currentFailure;
      controller.abort(); throw failure;
    }
  }
  try {
    const observedHeight = statusIdentity(await read('/api/v2/'), network);
    if (utxoObject(await read('/api/v2/block-index/0')).blockHash !== network.genesisHash) return utxoFailure('NETWORK_MISMATCH');
    let anchorHash: string | null = null;
    if (sampled) {
      const raw = utxoObject(await read(`/api/v2/block-index/${observedHeight}`)).blockHash;
      if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) return utxoFailure('INVALID_RESPONSE');
      anchorHash = raw;
    }
    return Object.freeze({ network, observedHeight, anchorHash, read, close, consumedBytes: () => consumed,
      async verifyAnchor() {
        try {
          if (!sampled) return utxoFailure('INVALID_INPUT');
          if (utxoObject(await read(`/api/v2/block-index/${observedHeight}`)).blockHash !== anchorHash) return utxoFailure('NETWORK_MISMATCH');
          const current = statusIdentity(await read('/api/v2/'), network);
          if (current < observedHeight) return utxoFailure('NETWORK_MISMATCH');
          check(); return current;
        } catch (cause) { close(); throw cause; }
      },
    });
  } catch (cause) { close(); throw cause instanceof UtxoBalanceError ? cause : new UtxoBalanceError('UNAVAILABLE'); }
}
