import { paliHttpHeaders } from '../../../../shared/paliHttpIdentity';

import { walletHttpIdentity } from './walletHttpIdentity';

let originalFetch: typeof fetch | null = null;

export function getPaliHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Pali-Wallet': 'true',
    'X-Requested-With': 'XMLHttpRequest',
  };
  const version =
    typeof chrome !== 'undefined'
      ? chrome.runtime?.getManifest?.().version
      : undefined;
  if (version) headers['X-Pali-Version'] = version;
  return headers;
}
function isJsonRpcBody(body: BodyInit | null | undefined): boolean {
  if (typeof body !== 'string' || body.length > 1024 * 1024) return false;
  try {
    const value = JSON.parse(body);
    const request = (item: any) =>
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      item.jsonrpc === '2.0' &&
      typeof item.method === 'string' &&
      ('params' in item || 'id' in item);
    return Array.isArray(value)
      ? value.length > 0 && value.every(request)
      : request(value);
  } catch {
    return false;
  }
}
type Identity = Pick<
  ReturnType<typeof walletHttpIdentity>,
  'isBackend' | 'isReady' | 'prepare'
>;

/** Keep Request streams intact; the Chrome network layer supplies the authoritative UA. */
export function createPaliFetch(
  fetcher: typeof fetch,
  identity: Identity
): typeof fetch {
  return async (input, init) => {
    const request =
      typeof Request !== 'undefined' && input instanceof Request
        ? input
        : undefined;
    const url = request?.url ?? String(input);
    const signal = init?.signal !== undefined ? init.signal : request?.signal;
    const check = () => {
      if (signal?.aborted)
        throw (
          signal.reason ??
          new DOMException('The operation was aborted', 'AbortError')
        );
    };
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const rpc = method === 'POST' && isJsonRpcBody(init?.body);
    check();
    if (!identity.isBackend(url)) return fetcher(input, init);
    const headers = paliHttpHeaders(
      init?.headers !== undefined ? init.headers : request?.headers
    );
    if (rpc)
      for (const [key, value] of Object.entries(getPaliHeaders()))
        headers.set(key, value);
    // Match fetch's synchronous Request snapshot before waiting for rule setup.
    // This owns body bytes/headers and consumes an incoming Request only once.
    const captured = new Request(input, {
      ...init,
      headers,
      credentials: 'omit',
    });
    if (identity.isReady(url)) return fetcher(captured);
    // Never insert a new async gap after the SDK's final guard for a POST.
    // Startup and explicit candidate probes install the rule before calling it.
    if (method !== 'GET' && method !== 'HEAD')
      throw new Error('Wallet HTTP identification is unavailable');
    if (!(await identity.prepare(url)))
      throw new Error('Wallet HTTP identification is unavailable');
    check();
    return fetcher(captured);
  };
}

export function patchFetchWithPaliHeaders(): void {
  if (originalFetch) return;
  const identity = walletHttpIdentity();
  const fetcher = globalThis.fetch;
  globalThis.fetch = createPaliFetch(fetcher.bind(globalThis), identity);
  originalFetch = fetcher;
}
export function unpatchFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
}
