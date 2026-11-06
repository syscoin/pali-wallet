import { observeFirstUseUtxoRpc, verifyOwnedUtxoRpc } from '@sidhujag/sysweb3-network/cjs/ownedUtxoRpc.js';
import { utxoRegistrationDisplayName } from '../../../../source/shared/utxoChainCatalogue.ts';
import { createUtxoRegistrationPin } from '../../../../source/shared/utxoRegistration.ts';
import { boundedResponseText, cancelResponseBody, ResponseSizeLimitError } from '../platformRpc.ts';
import { canonicalUtxoEndpoint, isCustomUtxoNetworkId, newCustomUtxoNetworkId, projectUtxoRegistration, resolveUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

export type UtxoFetch = (url: string, init: RequestInit) => Promise<Response>;
export function exactUtxoResponseFetch(fetch: UtxoFetch): UtxoFetch {
  return async (url, init) => {
    const response = await fetch(url, init);
    if (response.redirected || response.url !== url) {
      cancelResponseBody(response);
      return utxoFailure('NETWORK_MISMATCH');
    }
    return response;
  };
}
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
function readStatus(value: unknown, network: UtxoNetwork) {
  const root = utxoObject(value), blockbook = utxoObject(root.blockbook), backend = utxoObject(root.backend, true);
  if (blockbook.decimals !== network.decimals || backend.chain !== network.backendChain)
    return utxoFailure('NETWORK_MISMATCH');
  if (blockbook.initialSync !== false || blockbook.inSync !== true || blockbook.inSyncMempool !== true) return utxoFailure('UNAVAILABLE');
  return { coin: blockbook.coin, network: blockbook.network, height: utxoCount(blockbook.bestHeight) };
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

function openUtxoTransport(endpoint: string, options: Readonly<{ fetch: UtxoFetch; timeoutMs: number }>, external: AbortSignal,
  totalBytes: number, responseBytes: number, assertCurrent?: () => void) {
  if (!Number.isSafeInteger(responseBytes) || responseBytes < 1 || responseBytes > 1024 * 1024) return utxoFailure('INVALID_INPUT');
  if (external.aborted) return utxoFailure('CANCELLED');
  const controller = new AbortController(); let failure: UtxoBalanceError | null = null, consumed = 0;
  const abort = () => controller.abort(); external.addEventListener('abort', abort, { once: true });
  if (external.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs);
  const close = () => { controller.abort(); clearTimeout(timer); external.removeEventListener('abort', abort); };
  const check = () => {
    if (failure) throw failure;
    if (controller.signal.aborted) return utxoFailure('CANCELLED');
    if (assertCurrent) {
      try {
        const checked: unknown = assertCurrent();
        if (checked !== undefined) {
          void Promise.resolve(checked).catch(() => undefined);
          return utxoFailure('CANCELLED');
        }
      } catch { return utxoFailure('CANCELLED'); }
    }
  };
  const charge = (bytes: number) => { if (bytes > totalBytes - consumed) throw new ResponseSizeLimitError(); consumed += bytes; };
  async function read(path: string, retryUnavailable = false): Promise<unknown> {
    try {
      check();
      const url = endpoint + path;
      const pending = Promise.resolve().then(() => { check(); return options.fetch(url, {
        method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal,
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      }); }).then((response) => {
        try { check(); return response; }
        catch (error) { cancelResponseBody(response); throw error; }
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
  const statusPath = '/api/v2/', genesisPath = '/api/v2/block-index/0';
  function identityPath(url: string, signal: AbortSignal) {
    if (signal !== controller.signal) return utxoFailure('INVALID_INPUT');
    if (url === endpoint + statusPath) return statusPath;
    if (url === endpoint + genesisPath) return genesisPath;
    return utxoFailure('INVALID_INPUT');
  }
  return { signal: controller.signal, check, read, close, identityPath, consumedBytes: () => consumed };
}

/** Recheck the exact saved endpoint before a custody read or dispatch. */
export async function verifySavedUtxoEndpoint(
  network: UtxoNetwork,
  options: Readonly<{ fetch: UtxoFetch; timeoutMs: number }>,
  signal: AbortSignal,
  assertCurrent: () => void
): Promise<void> {
  await verifyUtxoRegistration({
    endpoint: network.endpoint, name: network.name, explorer: network.explorer,
  }, network, { ...options, fetch: exactUtxoResponseFetch(options.fetch) }, signal, assertCurrent);
}

/** Discover or reverify a registration without any address or account-key requests. */
export async function verifyUtxoRegistration(
  draft: Readonly<{ endpoint: string; name: string; explorer: string }>,
  expected: UtxoNetwork | undefined,
  options: Readonly<{ fetch: UtxoFetch; timeoutMs: number }>,
  external: AbortSignal,
  assertCurrent: () => void
): Promise<UtxoNetwork> {
  const endpoint = canonicalUtxoEndpoint(draft.endpoint);
  const explorer = draft.explorer ? canonicalUtxoEndpoint(draft.explorer) : endpoint;
  const { name } = draft;
  const selected = expected === undefined ? undefined : resolveUtxoNetwork(expected);
  const transport = openUtxoTransport(endpoint, options, external, 64 * 1024, 32 * 1024, assertCurrent);
  const owner = {
    assertCurrent: transport.check, signal: transport.signal,
    readJson: (url: string, signal: AbortSignal) => transport.read(transport.identityPath(url, signal)),
  };
  try {
    if (selected) {
      const pin = createUtxoRegistrationPin(selected);
      await verifyOwnedUtxoRpc(endpoint, { ...owner, ...pin });
      transport.check();
      return projectUtxoRegistration({ id: selected.id, ...pin.registration, backendChain: pin.backendChain,
        endpoint, name: name || selected.name, explorer });
    }
    const observed = await observeFirstUseUtxoRpc(endpoint, owner);
    observed.assertCurrent();
    return projectUtxoRegistration({ id: newCustomUtxoNetworkId(), ...observed.registration, backendChain: observed.observedBackendChain,
      endpoint, name: name || utxoRegistrationDisplayName(observed.coin), explorer });
  } finally { transport.close(); }
}

/** Shared bounded transport boundary. No address is disclosed during opening. */
export async function openUtxoReadSession(scope: UtxoNetworkId | UtxoNetwork, options: Readonly<{ fetch: UtxoFetch; timeoutMs: number }>, external: AbortSignal,
  sampled = false, totalBytes = Number.MAX_SAFE_INTEGER, responseBytes = 32768, assertCurrent?: () => void): Promise<UtxoReadSession> {
  let network: UtxoNetwork;
  try { network = resolveUtxoNetwork(scope); } catch { return utxoFailure('INVALID_INPUT'); }
  if (isCustomUtxoNetworkId(network.id) && typeof assertCurrent !== 'function') return utxoFailure('INVALID_INPUT');
  const { signal, check, read, close, identityPath, consumedBytes } = openUtxoTransport(network.endpoint, options, external, totalBytes, responseBytes, assertCurrent);
  try {
    let status: ReturnType<typeof readStatus> | undefined;
    let validationFailure: UtxoBalanceError | undefined;
    try {
      await verifyOwnedUtxoRpc(network.endpoint, {
        ...createUtxoRegistrationPin(network),
        assertCurrent: check,
        signal,
        async readJson(url, ownerSignal) {
          const path = identityPath(url, ownerSignal);
          const body = await read(path);
          try {
            if (path === '/api/v2/') status = readStatus(body, network);
            else utxoObject(body);
          } catch (error) {
            if (error instanceof UtxoBalanceError) validationFailure = error;
            throw error;
          }
          return body;
        },
      });
    } catch {
      check();
      if (validationFailure) throw validationFailure;
      return utxoFailure('NETWORK_MISMATCH');
    }
    if (status === undefined) return utxoFailure('INVALID_RESPONSE');
    const verified = status;
    const verifiedHeight = verified.height;
    let anchorHash: string | null = null;
    if (sampled) {
      const raw = utxoObject(await read(`/api/v2/block-index/${verifiedHeight}`)).blockHash;
      if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) return utxoFailure('INVALID_RESPONSE');
      anchorHash = raw;
    }
    return Object.freeze({ network, observedHeight: verifiedHeight, anchorHash, read, close, consumedBytes,
      async verifyAnchor() {
        try {
          if (!sampled) return utxoFailure('INVALID_INPUT');
          if (utxoObject(await read(`/api/v2/block-index/${verifiedHeight}`)).blockHash !== anchorHash) return utxoFailure('NETWORK_MISMATCH');
          const current = readStatus(await read('/api/v2/'), network);
          if (current.height < verifiedHeight || current.coin !== verified.coin || current.network !== verified.network)
            return utxoFailure('NETWORK_MISMATCH');
          check(); return current.height;
        } catch (cause) { close(); throw cause; }
      },
    });
  } catch (cause) { close(); throw cause instanceof UtxoBalanceError ? cause : new UtxoBalanceError('UNAVAILABLE'); }
}
