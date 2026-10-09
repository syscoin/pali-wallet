const ROUTESCAN_ORIGIN = 'https://api.routescan.io';
const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_INTERVAL_MS = 550; // Stay below the keyless tier's two requests/second.
const MAX_PAGES = 10;
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
let routescanQueue = Promise.resolve();
let lastRoutescanRequestAt = 0;

type TokenRow = Record<string, unknown>;
const cache = new Map<
  string,
  { expires: number; result: Promise<TokenRow[]> }
>();

export class TokenDiscoveryError extends Error {
  constructor(message: string, public readonly retryAfterMs = 0) {
    super(message);
  }
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

export const fetchRoutescan = async (
  url: string,
  options: RequestInit = {}
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
    lastRoutescanRequestAt = Date.now();
    return await fetch(requestUrl.toString(), { ...options, headers, signal });
  } finally {
    if (timeout) clearTimeout(timeout);
    release();
  }
};

const retryAfterMs = (value: string | null): number => {
  if (!value) return 0;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(duration)
    ? Math.max(0, Math.min(duration, 15 * 60_000))
    : 0;
};

const requestRows = async (
  apiUrl: string,
  walletAddress: string,
  chainId: number,
  includeNfts: boolean
): Promise<TokenRow[]> => {
  if (!/^0x[0-9a-f]{40}$/i.test(walletAddress)) {
    throw new TokenDiscoveryError('Invalid token discovery address');
  }
  const url = new URL(apiUrl);
  const routescan = url.origin === ROUTESCAN_ORIGIN;
  if (routescan && !isRoutescanApiUrl(apiUrl, chainId)) {
    throw new TokenDiscoveryError('Token discovery API does not match network');
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (routescan) {
    url.pathname = `/v2/network/mainnet/evm/${chainId}/address/${walletAddress}/erc20-holdings`;
    const apiKey =
      url.searchParams.get('apikey') || url.searchParams.get('apiKey');
    if (apiKey) headers.apikey = apiKey;
    url.search = '';
    url.searchParams.set('limit', '100');
  } else {
    // Preserve custom paths and chain parameters, including unified API URLs.
    if (url.pathname === '/') url.pathname = '/api';
    const apiKey = url.searchParams.get('apiKey');
    if (apiKey && !url.searchParams.has('apikey')) {
      url.searchParams.set('apikey', apiKey);
      url.searchParams.delete('apiKey');
    }
    url.searchParams.set('module', 'account');
    url.searchParams.set('action', 'tokenlist');
    url.searchParams.set('address', walletAddress);
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const rows: TokenRow[] = [];
    const collections = new Map<string, { ids: Set<string>; row: TokenRow }>();
    const kinds =
      routescan && includeNfts ? ['erc20', 'erc721', 'erc1155'] : ['erc20'];
    for (const kind of kinds) {
      if (routescan) {
        url.pathname = `/v2/network/mainnet/evm/${chainId}/address/${walletAddress}/${kind}-holdings`;
        url.searchParams.delete('next');
      }
      const cursors = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const request = routescan ? fetchRoutescan : fetch;
        const response = await request(url.toString(), {
          headers,
          signal: abort.signal,
        });
        if (!response.ok) {
          // A rate limit ends this load immediately; the caller applies cooldown.
          throw new TokenDiscoveryError(
            `API request failed with status ${response.status}`,
            retryAfterMs(response.headers.get('Retry-After'))
          );
        }
        const data = await response.json();
        if (!routescan) {
          if (
            data?.status === '0' &&
            /^no tokens found$/i.test(String(data.message || data.result || ''))
          ) {
            return [];
          }
          if (data?.status !== '1' || !Array.isArray(data.result)) {
            throw new TokenDiscoveryError(
              'Token discovery API returned an unsuccessful response'
            );
          }
          return data.result;
        }
        if (!Array.isArray(data?.items) || data.items.length > 100) {
          throw new TokenDiscoveryError(
            'Token discovery API returned invalid holdings'
          );
        }
        for (const item of data.items) {
          if (String(item?.chainId) !== String(chainId)) continue;
          if (kind === 'erc20') {
            // Missing metadata must not invent 18 decimals for a discovered token.
            if (
              item.tokenDecimals === null ||
              item.tokenDecimals === undefined ||
              typeof item.tokenQuantity !== 'string' ||
              !/^\d+$/.test(item.tokenQuantity)
            )
              continue;
            rows.push({
              contractAddress: item.tokenAddress,
              name: item.tokenName,
              symbol: item.tokenSymbol,
              decimals: item.tokenDecimals,
              balance: item.tokenQuantity,
              type: 'ERC-20',
            });
          } else if (
            typeof item.tokenId === 'string' &&
            /^\d+$/.test(item.tokenId)
          ) {
            if (kind === 'erc721' && typeof item.tokenAddress === 'string') {
              const key = item.tokenAddress.toLowerCase();
              let collection = collections.get(key);
              if (!collection) {
                collection = {
                  row: {
                    contractAddress: item.tokenAddress,
                    name: item.collectionName,
                    symbol: item.collectionSymbol,
                    decimals: 0,
                    type: 'ERC-721',
                  },
                  ids: new Set(),
                };
                collections.set(key, collection);
              }
              collection.ids.add(item.tokenId);
            } else if (
              kind === 'erc1155' &&
              typeof item.balance === 'string' &&
              /^\d+$/.test(item.balance)
            ) {
              rows.push({
                contractAddress: item.tokenAddress,
                id: item.tokenId,
                balance: item.balance,
                decimals: 0,
                type: 'ERC-1155',
              });
            }
          }
        }
        const cursor = data.link?.nextToken;
        if (!cursor) {
          if (data.link?.next) {
            throw new TokenDiscoveryError(
              'Token discovery API returned a missing cursor'
            );
          }
          break;
        }
        if (
          typeof cursor !== 'string' ||
          cursor.length > 4096 ||
          cursors.has(cursor) ||
          page === MAX_PAGES - 1
        ) {
          throw new TokenDiscoveryError(
            'Token discovery pagination limit reached'
          );
        }
        cursors.add(cursor);
        // Never follow provider-supplied URLs; cursors stay on the configured host.
        url.searchParams.set('next', cursor);
      }
    }
    for (const collection of collections.values()) {
      rows.push({ ...collection.row, balance: String(collection.ids.size) });
    }
    return rows;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchOwnedTokenRows = (
  apiUrl: string,
  walletAddress: string,
  chainId: number,
  includeNfts = false
): Promise<TokenRow[]> => {
  const key = `${chainId}:${apiUrl}:${walletAddress.toLowerCase()}:${includeNfts}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = requestRows(apiUrl, walletAddress, chainId, includeNfts);
  const entry = { expires: Date.now() + CACHE_MS, result };
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  void result.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return result;
};
