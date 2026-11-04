import { paliHttpHeaders } from '../../../../source/shared/paliHttpIdentity.ts';

export type WalletHttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Native transport policy. Pass the captured URL directly, never through RN Request. */
export function createNativeHttpFetch(transport: WalletHttpFetch): WalletHttpFetch {
  return async (url, init) => {
    if (typeof url !== 'string' || !url) throw new Error('Invalid wallet request URL');
    if (!init || typeof init !== 'object' || Array.isArray(init)) throw new Error('Invalid wallet request options');
    let headers: Headers;
    try { headers = paliHttpHeaders(init.headers); }
    catch { throw new Error('Invalid wallet request headers'); }
    headers.delete('Cookie');
    headers.delete('Cookie2');
    headers.delete('Referer');
    headers.set('Cache-Control', 'no-store, no-cache');
    headers.set('Pragma', 'no-cache');
    // Expo fetch does not implement RequestInit cache/referrerPolicy. Explicit
    // HTTP headers request no caching; this is not a native allocation bound.
    return transport(url, {
      method: init.method,
      headers,
      body: init.body,
      signal: init.signal,
      credentials: 'omit',
      redirect: 'error',
    });
  };
}
