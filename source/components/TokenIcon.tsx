/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react';

import PaliLogo from 'assets/all_assets/favicon-32.png';
import { NftFallbackSvg } from 'components/Icon/Icon';
import { Tooltip } from 'components/Tooltip/Tooltip';
import { NFT_FALLBACK_IMAGE } from 'utils/nftFallback';
import { getKnownTokenLogo, sanitizeUtxoTokenLogo } from 'utils/tokens';

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

const pruneTokenImageCache = () => {
  if (tokenImageCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = tokenImageCache.keys().next().value;
    if (oldestKey !== undefined) tokenImageCache.delete(oldestKey);
  }
};

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
    const knownLogo = getKnownTokenLogo(symbol, contractAddress, assetGuid);
    const safeProvidedLogo =
      assetGuid !== undefined ? sanitizeUtxoTokenLogo(logo, assetGuid) : logo;
    const resolvedLogo = knownLogo || safeProvidedLogo;

    // Create a unique cache key
    const getCacheKey = () => {
      // If we have a logo URL, use that as the key (most specific)
      if (resolvedLogo) return resolvedLogo;
      // For EVM tokens, use contract address
      if (contractAddress) return contractAddress.toLowerCase();
      // For UTXO tokens, use asset GUID
      if (assetGuid) return assetGuid;
      // Fallback to symbol if nothing else
      return symbol || 'unknown';
    };

    const cacheKey = getCacheKey();
    const imageScopeRef = useRef({ key: cacheKey, active: true });
    if (imageScopeRef.current.key !== cacheKey)
      imageScopeRef.current = { key: cacheKey, active: true };
    const imageScope = imageScopeRef.current;
    useEffect(() => {
      imageScopeRef.current.active = true;
      return () => {
        imageScopeRef.current.active = false;
      };
    }, []);

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
      if (!resolvedLogo) {
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
    const [iconState, setIconState] = useState({ ...initial, key: cacheKey });
    // Props may change before effects run; never render another token's state.
    const {
      url: iconUrl,
      error,
      loading: isLoading,
    } = iconState.key === cacheKey ? iconState : initial;

    useEffect(() => {
      let current = true;
      const cleanup = () => {
        current = false;
      };
      const applyResult = (url: string | null) => {
        if (current)
          setIconState({ key: cacheKey, url, error: !url, loading: false });
      };
      setIconState({ ...getInitialState(), key: cacheKey });
      // Skip if no logo URL or already cached
      if (!resolvedLogo || tokenImageCache.has(cacheKey)) {
        return cleanup;
      }

      // Skip if it's a Pali logo (already local)
      if (resolvedLogo === PaliLogo || resolvedLogo === NFT_FALLBACK_IMAGE) {
        applyResult(resolvedLogo);
        // Don't cache local assets
        return cleanup;
      }

      // Check if there's already a pending request
      const existingRequest = pendingTokenRequests.get(cacheKey);
      if (existingRequest) {
        existingRequest.then(applyResult, () => applyResult(null));
        return cleanup;
      }

      // Create fetch promise for deduplication
      const fetchIcon = async (): Promise<string | null> => {
        try {
          const response = await fetch(resolvedLogo);
          if (!response.ok) throw new Error('Failed to fetch');

          const blob = await response.blob();
          // If it's too large for base64 caching, just cache the URL so it can still render reliably
          if (blob.size > MAX_CACHED_BLOB_BYTES) {
            // Enforce LRU cap
            pruneTokenImageCache();
            tokenImageCache.set(cacheKey, resolvedLogo);
            tokenImageFailureTs.delete(cacheKey);
            return resolvedLogo;
          }
          const reader = new FileReader();

          return new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              // Enforce LRU cap
              pruneTokenImageCache();
              tokenImageCache.set(cacheKey, dataUrl);
              tokenImageFailureTs.delete(cacheKey);
              resolve(dataUrl);
            };

            reader.onerror = () => {
              pruneTokenImageCache();
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
          applyResult(dataUrl);
          pendingTokenRequests.delete(cacheKey); // Clean up
        })
        .catch(() => {
          applyResult(null);
          pendingTokenRequests.delete(cacheKey); // Clean up
        });
      return cleanup;
    }, [resolvedLogo, cacheKey]);

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
    if (error || !imageToRender) {
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
        key={cacheKey}
        src={imageToRender}
        alt={symbol || 'Token'}
        className={`${fallbackClassName} ${className}`}
        style={{ width: size, height: size }}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (!imageScope.active || imageScopeRef.current !== imageScope)
            return;
          if (!tokenImageCache.has(cacheKey)) pruneTokenImageCache();
          tokenImageCache.set(cacheKey, null);
          tokenImageFailureTs.set(cacheKey, Date.now());
          setIconState({
            key: cacheKey,
            url: null,
            error: true,
            loading: false,
          });
        }}
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

// Shared across connection approvals; React.memo retains stable-prop skips.
export const TokenIconStack = React.memo(
  ({ tokens, maxVisible = 3 }: { maxVisible?: number; tokens: any[] }) => {
    if (!tokens || tokens.length === 0) return null;

    const getVisualKey = (token: any) => {
      if (token.logo) return `logo:${token.logo}`;
      if (token.symbol) return `symbol:${token.symbol.charAt(0).toUpperCase()}`;
      return `address:${token.contractAddress || token.assetGuid}`;
    };

    const uniqueTokens = tokens.reduce((acc: any[], token: any) => {
      const visualKey = getVisualKey(token);
      const exists = acc.some((t) => getVisualKey(t) === visualKey);
      if (!exists) {
        acc.push(token);
      }
      return acc;
    }, []);

    const sortedTokens = uniqueTokens.sort(
      (a, b) => Number(Boolean(b.logo)) - Number(Boolean(a.logo))
    );

    const visibleTokens = sortedTokens.slice(0, maxVisible);
    const remainingCount = uniqueTokens.length - visibleTokens.length;

    return (
      <div className="flex items-center">
        <div className="flex">
          {visibleTokens.map((token, index) => (
            <Tooltip
              key={
                token.id || token.contractAddress || token.assetGuid || index
              }
              content={token.name || token.symbol}
            >
              <div
                className="relative hover:scale-110 hover:shadow-md transition-transform duration-200"
                style={{
                  marginLeft: index > 0 ? '-8px' : '0',
                  zIndex: visibleTokens.length - index,
                }}
              >
                <TokenIcon
                  logo={token.logo}
                  contractAddress={token.contractAddress}
                  assetGuid={token.assetGuid}
                  symbol={token.symbol}
                  size={16}
                  className="border border-bkg-3 rounded-full"
                />
              </div>
            </Tooltip>
          ))}
        </div>
        {remainingCount > 0 && (
          <span className="ml-1 text-[10px] text-brand-royalblue">
            +{remainingCount}
          </span>
        )}
      </div>
    );
  }
);
TokenIconStack.displayName = 'TokenIconStack';

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
            pruneTokenImageCache();
            tokenImageCache.set(url, dataUrl);
            resolve(dataUrl);
          };
          reader.onerror = () => {
            pruneTokenImageCache();
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
