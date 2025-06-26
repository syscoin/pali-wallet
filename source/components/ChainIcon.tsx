/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react';

import { INetworkType } from '@pollum-io/sysweb3-network';

import {
  ChainFallbackSvg,
  EthChainSvg,
  RolluxChainSvg,
  SysChainSvg,
} from 'components/Icon/Icon';
import { getChainIconUrl } from 'utils/chainIcons';

// Cache for actual image data URLs (base64) to prevent any network requests
const imageDataCache = new Map<number, string | null>();

/**
 * Simple Cache Strategy:
 *
 * imageDataCache: Maps chainId → base64 data URLs or null if failed
 * - Key: chainId (e.g., 1, 137, 570)
 * - Value: "data:image/jpeg;base64,..." or null if failed to load
 * - Purpose: Prevents ALL HTTP requests by storing actual image data
 */

interface IChainIconProps {
  chainId: number;
  className?: string;
  fallbackClassName?: string;
  iconName?: string;
  networkKind?: INetworkType;
  size?: number | string; // Optional icon name for custom networks
}

// Known chain icons that we have locally
const KNOWN_CHAIN_ICONS: {
  [chainId: number]:
    | React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    | string;
} = {
  1: EthChainSvg, // Ethereum Mainnet
  5: EthChainSvg, // Ethereum Goerli (testnet)
  11155111: EthChainSvg, // Ethereum Sepolia (testnet)
  57: SysChainSvg, // Syscoin UTXO
  570: RolluxChainSvg, // Rollux Mainnet
  5700: SysChainSvg, // Syscoin NEVM Testnet
  57000: RolluxChainSvg, // Rollux Testnet
};

/**
 * Component to display chain icons dynamically from ChainList
 * Falls back to local icons for known chains, then to Pali logo
 */
export const ChainIcon: React.FC<IChainIconProps> = React.memo(
  ({
    chainId,
    size = 24,
    className = '',
    fallbackClassName = 'rounded-full',
    networkKind,
    iconName,
  }) => {
    // Determine initial state based on what we already know
    const getInitialState = () => {
      // Check known local icons first
      if (KNOWN_CHAIN_ICONS[chainId]) {
        const icon = KNOWN_CHAIN_ICONS[chainId];
        return {
          url: typeof icon === 'string' ? icon : null,
          component: typeof icon !== 'string' ? icon : null,
          error: false,
          loading: false,
        };
      }

      // Check cache
      if (imageDataCache.has(chainId)) {
        const cached = imageDataCache.get(chainId);
        return {
          url: cached,
          component: null,
          error: cached === null,
          loading: false, // Never show loading for cached items
        };
      }

      // UTXO networks don't have remote icons
      if (networkKind === INetworkType.Syscoin) {
        return {
          url: null,
          component: null,
          error: true,
          loading: false,
        };
      }

      // Only show loading for truly new icons
      return {
        url: null,
        component: null,
        error: false,
        loading: true,
      };
    };

    const initial = getInitialState();
    const [iconUrl, setIconUrl] = useState<string | null>(initial.url);
    const [iconComponent, setIconComponent] = useState<React.ComponentType<{
      className?: string;
      style?: React.CSSProperties;
    }> | null>(initial.component || null);
    const [error, setError] = useState(initial.error);
    const [isLoading, setIsLoading] = useState(initial.loading);

    useEffect(() => {
      // Check if we have a known local icon first
      if (KNOWN_CHAIN_ICONS[chainId]) {
        const icon = KNOWN_CHAIN_ICONS[chainId];
        if (typeof icon === 'string') {
          if (iconUrl !== icon) {
            setIconUrl(icon);
            setIconComponent(null);
            setError(false);
            setIsLoading(false);
          }
        } else {
          if (iconComponent !== icon) {
            setIconUrl(null);
            setIconComponent(icon);
            setError(false);
            setIsLoading(false);
          }
        }
        return;
      }

      // Check cache for existing icon
      if (imageDataCache.has(chainId)) {
        const cachedUrl = imageDataCache.get(chainId);
        if (cachedUrl !== iconUrl) {
          setIconUrl(cachedUrl);
          setIconComponent(null);
          setError(cachedUrl === null);
          setIsLoading(false);
        }
        return;
      }

      // For UTXO networks, skip ChainList fetching as they're not in ChainList
      if (networkKind === INetworkType.Syscoin) {
        if (!error) {
          setError(true);
          setIsLoading(false);
        }
        return;
      }

      // Lazy load with delay to prevent blocking renderer
      const loadTimer = setTimeout(() => {
        // If an iconName is provided, try to use it for ChainList lookup
        if (iconName) {
          const iconUrls = [
            `https://icons.llamao.fi/icons/chains/rsz_${iconName}.jpg`,
            `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${iconName}/info/logo.png`,
          ];

          const tryIconUrl = (index: number) => {
            if (index >= iconUrls.length) {
              imageDataCache.set(chainId, null);
              setError(true);
              setIsLoading(false);
              return;
            }

            // Load image and convert to data URL for permanent caching
            fetch(iconUrls[index])
              .then((response) => {
                if (!response.ok) throw new Error('Failed to fetch');
                return response.blob();
              })
              .then((blob) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const dataUrl = reader.result as string;
                  imageDataCache.set(chainId, dataUrl);
                  setIconUrl(dataUrl);
                  setError(false);
                  setIsLoading(false);
                };
                reader.readAsDataURL(blob);
              })
              .catch(() => tryIconUrl(index + 1));
          };

          tryIconUrl(0);
          return;
        }

        // Otherwise try to fetch from ChainList (EVM networks only)
        getChainIconUrl(chainId)
          .then((url) => {
            if (url) {
              // Convert external URL to data URL for consistent caching
              fetch(url)
                .then((response) => {
                  if (!response.ok) throw new Error('Failed to fetch');
                  return response.blob();
                })
                .then((blob) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const dataUrl = reader.result as string;
                    imageDataCache.set(chainId, dataUrl);
                    setIconUrl(dataUrl);
                    setError(false);
                    setIsLoading(false);
                  };
                  reader.readAsDataURL(blob);
                })
                .catch(() => {
                  imageDataCache.set(chainId, null);
                  setError(true);
                  setIsLoading(false);
                });
            } else {
              imageDataCache.set(chainId, null);
              setError(true);
              setIsLoading(false);
            }
          })
          .catch(() => {
            imageDataCache.set(chainId, null);
            setError(true);
            setIsLoading(false);
          });
      }, 50); // Reduced from 150ms to 50ms for better UX while still preventing blocking

      return () => {
        clearTimeout(loadTimer);
      };
    }, [chainId, networkKind, iconName]);

    // Use fallback SVG for unknown chains
    if (error || (!iconUrl && !iconComponent && !isLoading)) {
      return (
        <ChainFallbackSvg
          className={`${fallbackClassName} ${className}`}
          style={{ width: size, height: size }}
          chainId={chainId}
        />
      );
    }

    // Show loading state
    if (isLoading && !iconUrl && !iconComponent) {
      return (
        <div
          className={`animate-pulse bg-gray-600 ${fallbackClassName} ${className}`}
          style={{ width: size, height: size }}
        />
      );
    }

    // Render SVG component if available
    if (iconComponent) {
      const IconComponent = iconComponent;
      return (
        <div style={{ width: size, height: size }} className={className}>
          <IconComponent
            className="w-full h-full rounded-full"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      );
    }

    // Render image URL
    return (
      <img
        src={iconUrl}
        alt={`Chain ${chainId}`}
        className={`rounded-full ${className}`}
        style={{ width: size, height: size }}
        onError={() => setError(true)}
      />
    );
  },
  // Proper memoization comparison
  (prevProps, nextProps) =>
    prevProps.chainId === nextProps.chainId &&
    prevProps.size === nextProps.size &&
    prevProps.className === nextProps.className &&
    prevProps.fallbackClassName === nextProps.fallbackClassName &&
    prevProps.networkKind === nextProps.networkKind &&
    prevProps.iconName === nextProps.iconName
);

ChainIcon.displayName = 'ChainIcon';
