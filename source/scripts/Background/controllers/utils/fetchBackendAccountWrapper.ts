import * as sys from 'syscoinjs-lib';

// Cache for in-flight requests to prevent duplicate network calls
const requestCache = new Map<
  string,
  {
    abortController?: AbortController;
    promise: Promise<any>;
    timestamp: number;
  }
>();

// Cache cleanup - remove entries older than 5 seconds
const CACHE_TTL = 5000;
const cleanupCache = () => {
  const now = Date.now();
  requestCache.forEach((entry, key) => {
    if (now - entry.timestamp > CACHE_TTL) {
      // Cancel any pending request before removing
      if (entry.abortController) {
        entry.abortController.abort();
      }
      requestCache.delete(key);
    }
  });
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
  parseData: boolean,
  signal?: AbortSignal
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

  // Create abort controller for this request
  const abortController = new AbortController();

  // If an external signal is provided, link it to our abort controller
  if (signal) {
    signal.addEventListener('abort', () => {
      abortController.abort();
    });
  }

  // Create new request and cache it
  console.log(
    `[fetchBackendAccountWrapper] Creating new request for ${cacheKey}`
  );

  const requestPromise = sys.utils
    .fetchBackendAccount(networkUrl, xpub, requestOptions, parseData)
    .catch((error) => {
      // If the request was aborted, throw a specific error
      if (abortController.signal.aborted) {
        throw new Error('Request was cancelled');
      }
      throw error;
    });

  // Store the promise in cache with abort controller
  requestCache.set(cacheKey, {
    promise: requestPromise,
    timestamp: Date.now(),
    abortController,
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
  // Cancel all pending requests
  requestCache.forEach((entry) => {
    if (entry.abortController) {
      entry.abortController.abort();
    }
  });
  requestCache.clear();
};
