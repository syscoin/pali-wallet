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
const HISTORY_CACHE_MS = 30_000;
const HISTORY_ACTIONS = new Set(['txlist', 'tokentx', 'pendingtxlist']);

/** Retire queued/pacing work without handing off a still-owned physical request. */
function waitForRoutescanDispatch(
  wait: number | Promise<void>,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      complete();
    };
    const cancel = () =>
      finish(() => reject(new Error('Explorer API request timed out')));
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, { once: true });
    if (typeof wait === 'number')
      timer = setTimeout(() => finish(resolve), wait);
    else
      void wait.then(
        () => finish(resolve),
        (error) => finish(() => reject(error))
      );
  });
}

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
  let lastRoutescanRequestAt: number | undefined;
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
    const signal = options.signal || abort!.signal;
    const timeout = abort
      ? setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
      : undefined;
    const previous = routescanQueue;
    let release!: () => void;
    routescanQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    let admitted = false;
    try {
      await waitForRoutescanDispatch(previous, signal);
      admitted = true;
      const delay =
        lastRoutescanRequestAt === undefined
          ? 0
          : Math.max(
              0,
              lastRoutescanRequestAt + PAGE_INTERVAL_MS - performance.now()
            );
      if (delay) await waitForRoutescanDispatch(delay, signal);
      if (signal.aborted) throw new Error('Explorer API request timed out');
      assertCurrent?.();
      lastRoutescanRequestAt = performance.now();
      if (
        requestUrl.origin === ROUTESCAN_ORIGIN &&
        /^\/v2\/network\/mainnet\/evm\/\d+\/etherscan\/api\/?$/.test(
          requestUrl.pathname
        ) &&
        (options.method === undefined ||
          options.method.toUpperCase() === 'GET') &&
        requestUrl.searchParams.get('module') === 'account' &&
        HISTORY_ACTIONS.has(requestUrl.searchParams.get('action') ?? '')
      )
        // Routescan's CDN ignores no-cache headers; share a bounded cache window.
        requestUrl.searchParams.set(
          '_pali_refresh',
          String(Math.floor(Date.now() / HISTORY_CACHE_MS))
        );
      return await fetcher(requestUrl.toString(), {
        ...options,
        headers,
        signal,
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (admitted) release();
      else void previous.then(release, release);
    }
  };
};
