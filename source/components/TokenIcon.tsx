/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react';

import PaliLogo from 'assets/all_assets/favicon-32.png';
import { NftFallbackSvg } from 'components/Icon/Icon';
import { NFT_FALLBACK_IMAGE } from 'utils/nftFallback';

// Cache for actual image data URLs (base64) to prevent any network requests
// Add a simple LRU cap to prevent unbounded growth
const MAX_CACHE_ENTRIES = 200;
const tokenImageCache = new Map<string, string | null>();
// Track when a cache key last failed so we can retry later
const tokenImageFailureTs = new Map<string, number>();
// Retry failed icon fetches after a short cooldown (prevents permanent "stuck" fallbacks)
const FAILURE_RETRY_MS = 5 * 60 * 1000; // 5 minutes
// If an image is too large to safely base64-cache, fall back to rendering the URL directly
const MAX_CACHED_BLOB_BYTES = 256 * 1024; // 256KB

// Track in-flight requests to prevent duplicate fetches
const pendingTokenRequests = new Map<string, Promise<string | null>>();

/**
 * Token Icon Cache Strategy:
 *
 * tokenImageCache: Maps tokenKey → base64 data URLs or null if failed
 * - Key: Unique identifier (contractAddress for EVM, assetGuid for UTXO, or logo URL)
 * - Value: "data:image/...;base64,..." or null if failed to load
 * - Purpose: Prevents ALL HTTP requests by storing actual image data
 */

interface ITokenIconProps {
  // UTXO specific
  assetGuid?: string;
  // Common props
  className?: string;
  // EVM specific
  contractAddress?: string;
  fallbackClassName?: string;
  isNft?: boolean;
  logo?: string;
  size?: number | string;
  symbol?: string;
}

/**
 * Component to display token icons with caching
 * Falls back to Pali logo for fungible tokens or NFT fallback for NFTs
 */
export const TokenIcon: React.FC<ITokenIconProps> = React.memo(
  ({
    assetGuid,
    className = '',
    contractAddress,
    fallbackClassName = 'rounded-full',
    isNft = false,
    logo,
    size = 24,
    symbol,
  }) => {
    // Create a unique cache key
    const getCacheKey = () => {
      // If we have a logo URL, use that as the key (most specific)
      if (logo) return logo;
      // For EVM tokens, use contract address
      if (contractAddress) return contractAddress.toLowerCase();
      // For UTXO tokens, use asset GUID
      if (assetGuid) return assetGuid;
      // Fallback to symbol if nothing else
      return symbol || 'unknown';
    };

    const cacheKey = getCacheKey();

    // Determine initial state based on cache
    const getInitialState = () => {
      // Check cache first
      if (tokenImageCache.has(cacheKey)) {
        const cached = tokenImageCache.get(cacheKey);
        // If we previously cached a failure (null), allow retry after cooldown
        if (cached === null) {
          const failedAt = tokenImageFailureTs.get(cacheKey) || 0;
          if (failedAt && Date.now() - failedAt >= FAILURE_RETRY_MS) {
            tokenImageCache.delete(cacheKey);
            tokenImageFailureTs.delete(cacheKey);
          } else {
            return {
              url: null,
              error: true,
              loading: false,
            };
          }
        } else {
          return {
            url: cached,
            error: false,
            loading: false,
          };
        }
        return {
          url: cached,
          error: cached === null,
          loading: false,
        };
      }

      // No logo URL provided, use fallback immediately
      if (!logo) {
        return {
          url: null,
          error: true,
          loading: false,
        };
      }

      // Need to load the logo
      return {
        url: null,
        error: false,
        loading: true,
      };
    };

    const initial = getInitialState();
    const [iconUrl, setIconUrl] = useState<string | null>(initial.url);
    const [error, setError] = useState(initial.error);
    const [isLoading, setIsLoading] = useState(initial.loading);

    useEffect(() => {
      // Skip if no logo URL or already cached
      if (!logo || tokenImageCache.has(cacheKey)) {
        return;
      }

      // Skip if it's a Pali logo (already local)
      if (logo === PaliLogo || logo === NFT_FALLBACK_IMAGE) {
        setIconUrl(logo);
        setError(false);
        setIsLoading(false);
        // Don't cache local assets
        return;
      }

      // Check if there's already a pending request
      const existingRequest = pendingTokenRequests.get(cacheKey);
      if (existingRequest) {
        existingRequest.then((dataUrl) => {
          if (dataUrl) {
            setIconUrl(dataUrl);
            setError(false);
          } else {
            setError(true);
          }
          setIsLoading(false);
        });
        return;
      }

      // Create fetch promise for deduplication
      const fetchIcon = async (): Promise<string | null> => {
        try {
          const response = await fetch(logo);
          if (!response.ok) throw new Error('Failed to fetch');

          const blob = await response.blob();
          // If it's too large for base64 caching, just cache the URL so it can still render reliably
          if (blob.size > MAX_CACHED_BLOB_BYTES) {
            // Enforce LRU cap
            if (tokenImageCache.size >= MAX_CACHE_ENTRIES) {
              const oldestKey = tokenImageCache.keys().next().value as
                | string
                | undefined;
              if (oldestKey !== undefined) tokenImageCache.delete(oldestKey);
            }
            tokenImageCache.set(cacheKey, logo);
            tokenImageFailureTs.delete(cacheKey);
            return logo;
          }
          const reader = new FileReader();

          return new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              // Enforce LRU cap
              if (tokenImageCache.size >= MAX_CACHE_ENTRIES) {
                const oldestKey = tokenImageCache.keys().next().value as
                  | string
                  | undefined;
                if (oldestKey !== undefined) tokenImageCache.delete(oldestKey);
              }
              tokenImageCache.set(cacheKey, dataUrl);
              tokenImageFailureTs.delete(cacheKey);
              resolve(dataUrl);
            };

            reader.onerror = () => {
              if (tokenImageCache.size >= MAX_CACHE_ENTRIES) {
                const oldestKey = tokenImageCache.keys().next().value as
                  | string
                  | undefined;
                if (oldestKey !== undefined) tokenImageCache.delete(oldestKey);
              }
              tokenImageCache.set(cacheKey, null);
              tokenImageFailureTs.set(cacheKey, Date.now());
              resolve(null);
            };

            reader.readAsDataURL(blob);
          });
        } catch (err) {
          // Cache the failure to prevent repeated attempts
          tokenImageCache.set(cacheKey, null);
          tokenImageFailureTs.set(cacheKey, Date.now());
          return null;
        }
      };

      // No delay - start fetching immediately to prevent flicker
      const promise = fetchIcon();
      pendingTokenRequests.set(cacheKey, promise);

      promise
        .then((dataUrl) => {
          if (dataUrl) {
            setIconUrl(dataUrl);
            setError(false);
          } else {
            setError(true);
          }
          setIsLoading(false);
          pendingTokenRequests.delete(cacheKey); // Clean up
        })
        .catch(() => {
          setError(true);
          setIsLoading(false);
          pendingTokenRequests.delete(cacheKey); // Clean up
        });
    }, [logo, cacheKey]);

    // Check if we have a cached image to use immediately
    const cachedImage = tokenImageCache.get(cacheKey);
    const imageToRender = iconUrl || cachedImage;

    // Show loading state only if we truly have nothing to show
    if (isLoading && !imageToRender && !error) {
      return (
        <div
          className={`animate-pulse bg-gray-600 ${fallbackClassName} ${className}`}
          style={{ width: size, height: size }}
        />
      );
    }

    // Use appropriate fallback
    if ((error || !imageToRender) && cachedImage !== null) {
      if (isNft) {
        return (
          <NftFallbackSvg
            className={`${fallbackClassName} ${className}`}
            style={{ width: size, height: size }}
          />
        );
      }

      // For fungible tokens, show symbol initial or Pali logo
      if (symbol) {
        return (
          <div
            className={`bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                        flex items-center justify-center ${fallbackClassName} ${className}`}
            style={{ width: size, height: size }}
          >
            <span className="text-white text-xs font-bold">
              {symbol.charAt(0).toUpperCase()}
            </span>
          </div>
        );
      }

      // Final fallback to Pali logo
      return (
        <img
          src={PaliLogo}
          alt="Token"
          className={`${fallbackClassName} ${className}`}
          style={{ width: size, height: size }}
          loading="lazy"
          decoding="async"
        />
      );
    }

    // Render the image (either from state or cache)
    return (
      <img
        src={imageToRender}
        alt={symbol || 'Token'}
        className={`${fallbackClassName} ${className}`}
        style={{ width: size, height: size }}
        loading="lazy"
        decoding="async"
      />
    );
  },
  // Proper memoization
  (prevProps, nextProps) =>
    prevProps.logo === nextProps.logo &&
    prevProps.contractAddress === nextProps.contractAddress &&
    prevProps.assetGuid === nextProps.assetGuid &&
    prevProps.symbol === nextProps.symbol &&
    prevProps.size === nextProps.size &&
    prevProps.className === nextProps.className &&
    prevProps.fallbackClassName === nextProps.fallbackClassName &&
    prevProps.isNft === nextProps.isNft
);

TokenIcon.displayName = 'TokenIcon';

// Export a function to clear the cache if needed
export const clearTokenIconCache = () => {
  tokenImageCache.clear();
};

// Export a function to preload token icons
export const preloadTokenIcons = async (logoUrls: string[]) => {
  const promises = logoUrls.map(async (url) => {
    if (!url || tokenImageCache.has(url)) return;

    // Check if already being fetched
    const existingRequest = pendingTokenRequests.get(url);
    if (existingRequest) {
      return existingRequest;
    }

    const fetchPromise = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const blob = await response.blob();
        // Skip caching very large images to avoid memory bloat (~256KB)
        if (blob.size > 256 * 1024) return null;
        const reader = new FileReader();

        return new Promise<string | null>((resolve) => {
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            if (tokenImageCache.size >= MAX_CACHE_ENTRIES) {
              const oldestKey = tokenImageCache.keys().next().value as
                | string
                | undefined;
              if (oldestKey !== undefined) tokenImageCache.delete(oldestKey);
            }
            tokenImageCache.set(url, dataUrl);
            resolve(dataUrl);
          };
          reader.onerror = () => {
            if (tokenImageCache.size >= MAX_CACHE_ENTRIES) {
              const oldestKey = tokenImageCache.keys().next().value as
                | string
                | undefined;
              if (oldestKey !== undefined) tokenImageCache.delete(oldestKey);
            }
            tokenImageCache.set(url, null);
            resolve(null);
          };
          reader.readAsDataURL(blob);
        });
      } catch {
        // Ignore errors in preloading
        return null;
      }
    })();

    pendingTokenRequests.set(url, fetchPromise);
    fetchPromise.finally(() => {
      pendingTokenRequests.delete(url);
    });

    return fetchPromise;
  });

  await Promise.all(promises);
};
