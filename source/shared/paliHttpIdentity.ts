/** Public client identification, never authentication or a wallet/device identifier. */
export const PALI_HTTP_USER_AGENT = 'PaliWallet';

export function paliHttpHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set('User-Agent', PALI_HTTP_USER_AGENT);
  return headers;
}
