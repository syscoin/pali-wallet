import sys from 'syscoinjs-lib';

// Request cache for deduplication
interface RequestCacheEntry {
  promise: Promise<any>;
  timestamp: number;
}

const requestCache = new Map<string, RequestCacheEntry>();
const CACHE_TTL = 2000; // 2 seconds TTL for pending requests

// Clean up expired cache entries
const cleanupCache = () => {
  const now = Date.now();
  for (const [key, entry] of requestCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      requestCache.delete(key);
    }
  }
};

// Create a unique key for the request
const createRequestKey = (
  networkUrl: string,
  xpub: string,
  requestOptions: string
): string => `${networkUrl}::${xpub}::${requestOptions}`;

/**
 * Wrapper around sys.utils.fetchBackendAccount that provides request deduplication
 * This prevents multiple identical requests from being made simultaneously
 */
export const fetchBackendAccountCached = async (
  networkUrl: string,
  xpub: string,
  requestOptions: string,
  parseData: boolean
): Promise<any> => {
  // Clean up old entries
  cleanupCache();

  const cacheKey = createRequestKey(networkUrl, xpub, requestOptions);

  // Check if we have an in-flight request for the same parameters
  const cachedEntry = requestCache.get(cacheKey);
  if (cachedEntry) {
    console.log(
      `[fetchBackendAccountWrapper] Using in-flight request for ${cacheKey}`
    );
    return cachedEntry.promise;
  }

  // Create new request and cache it
  console.log(
    `[fetchBackendAccountWrapper] Creating new request for ${cacheKey}`
  );
  const requestPromise = sys.utils.fetchBackendAccount(
    networkUrl,
    xpub,
    requestOptions,
    parseData
  );

  // Store the promise in cache
  requestCache.set(cacheKey, {
    promise: requestPromise,
    timestamp: Date.now(),
  });

  // Clean up cache entry after request completes
  requestPromise.finally(() => {
    // Small delay to handle rapid successive calls
    setTimeout(() => {
      requestCache.delete(cacheKey);
    }, 100);
  });

  return requestPromise;
};

// Export a function to clear all cached requests
export const clearFetchBackendAccountCache = () => {
  requestCache.clear();
  console.log('[fetchBackendAccountWrapper] Cache cleared');
};
