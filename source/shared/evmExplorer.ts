/** Pure Etherscan-compatible URL construction shared by native and extension hosts. */
export function buildAccountHistoryUrl(
  apiUrl: string,
  address: string,
  action: string,
  page?: number,
  offset = 30
): URL {
  const url = new URL(apiUrl);
  const apiKey =
    url.searchParams.get('apikey') || url.searchParams.get('apiKey');
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', action);
  url.searchParams.set('address', address);
  if (action !== 'pendingtxlist') url.searchParams.set('sort', 'desc');
  if (page !== undefined) {
    url.searchParams.set('page', String(page));
    url.searchParams.set('offset', String(offset));
  }
  if (apiKey) url.searchParams.set('apikey', apiKey);
  return url;
}

const ROUTESCAN_ORIGIN = 'https://api.routescan.io';
const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_INTERVAL_MS = 550; // Existing extension keyless-tier pacing.

export const isRoutescanApiUrl = (
  apiUrl: string | undefined,
  chainId: number
) => {
  try {
    const url = new URL(apiUrl || '');
    const path = url.pathname.replace(/\/$/, '');
    const base = `/v2/network/mainnet/evm/${chainId}`;
    return (
      url.origin === ROUTESCAN_ORIGIN &&
      (path === base || path === `${base}/etherscan/api`)
    );
  } catch {
    return false;
  }
};

export const createRoutescanFetch = (
  fetcher: (url: string, options: RequestInit) => Promise<Response> = (
    url,
    options
  ) => fetch(url, options)
) => {
  let routescanQueue = Promise.resolve();
  let lastRoutescanRequestAt = 0;
  return async (
    url: string,
    options: RequestInit = {},
    assertCurrent?: () => void
  ): Promise<Response> => {
    const requestUrl = new URL(url);
    const headers = new Headers(options.headers);
    const apiKey =
      requestUrl.searchParams.get('apikey') ||
      requestUrl.searchParams.get('apiKey');
    if (apiKey) headers.set('apikey', apiKey);
    requestUrl.searchParams.delete('apikey');
    requestUrl.searchParams.delete('apiKey');
    const abort = options.signal ? undefined : new AbortController();
    const signal = options.signal || abort?.signal;
    const timeout = abort
      ? setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
      : undefined;
    const previous = routescanQueue;
    let release!: () => void;
    routescanQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      const delay = Math.max(
        0,
        lastRoutescanRequestAt + PAGE_INTERVAL_MS - Date.now()
      );
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (signal?.aborted) throw new Error('Explorer API request timed out');
      assertCurrent?.();
      lastRoutescanRequestAt = Date.now();
      return await fetcher(requestUrl.toString(), {
        ...options,
        headers,
        signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      release();
    }
  };
};
