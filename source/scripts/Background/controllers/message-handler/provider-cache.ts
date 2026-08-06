import type { IEnhancedRequestContext } from './types';

// Provider responses can contain origin-specific account data. Host scoping
// prevents data crossing site boundaries, and the size cap prevents hostile
// sites from growing the cache without bound through many subdomains.
export const MAX_PROVIDER_CACHE_ENTRIES = 100;

interface IProviderStateCacheEntry {
  expiresAt: number;
  value: any;
}

const providerStateCache = new Map<string, IProviderStateCacheEntry>();

const pruneProviderCache = (now: number) => {
  for (const [key, cached] of providerStateCache) {
    if (cached.expiresAt <= now) {
      providerStateCache.delete(key);
    }
  }
};

export const clearProviderCache = () => {
  providerStateCache.clear();
};

export async function executeMethodWithCache(
  context: IEnhancedRequestContext,
  executor: () => Promise<any>
): Promise<any> {
  const { methodConfig } = context;

  if (methodConfig.cacheKey && methodConfig.cacheTTL) {
    const now = Date.now();
    pruneProviderCache(now);
    const originCacheKey = JSON.stringify([
      methodConfig.cacheKey,
      context.originalRequest.host,
    ]);
    const cached = providerStateCache.get(originCacheKey);

    if (cached) {
      // Refresh insertion order so the Map also acts as an LRU queue.
      providerStateCache.delete(originCacheKey);
      providerStateCache.set(originCacheKey, cached);
      return cached.value;
    }

    const result = await executor();
    const completedAt = Date.now();
    pruneProviderCache(completedAt);
    while (providerStateCache.size >= MAX_PROVIDER_CACHE_ENTRIES) {
      const oldestKey = providerStateCache.keys().next().value;
      if (oldestKey === undefined) break;
      providerStateCache.delete(oldestKey);
    }
    providerStateCache.set(originCacheKey, {
      expiresAt: completedAt + methodConfig.cacheTTL,
      value: result,
    });
    return result;
  }

  return executor();
}
