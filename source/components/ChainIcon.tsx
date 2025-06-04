/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react';

import ethChainImg from 'assets/images/ethChain.svg';
import PaliLogo from 'assets/images/pali-blank.png';
import rolluxChainImg from 'assets/images/rolluxChain.png';
import sysChainImg from 'assets/images/sysChain.svg';
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
  // Optional hint about network type
  iconName?: string;
  networkKind?: 'evm' | 'utxo';
  size?: number | string; // Optional icon name for custom networks
}

// Known chain icons that we have locally
const KNOWN_CHAIN_ICONS: { [chainId: number]: string } = {
  1: ethChainImg, // Ethereum Mainnet
  5: ethChainImg, // Ethereum Goerli (testnet)
  11155111: ethChainImg, // Ethereum Sepolia (testnet)
  57: sysChainImg, // Syscoin UTXO
  570: rolluxChainImg, // Rollux Mainnet
  5700: sysChainImg, // Syscoin NEVM Testnet
  57000: rolluxChainImg, // Rollux Testnet
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
        return {
          url: KNOWN_CHAIN_ICONS[chainId],
          error: false,
          loading: false,
        };
      }

      // Check cache
      if (imageDataCache.has(chainId)) {
        const cached = imageDataCache.get(chainId);
        return {
          url: cached,
          error: cached === null,
          loading: false, // Never show loading for cached items
        };
      }

      // UTXO networks don't have remote icons
      if (networkKind === 'utxo') {
        return {
          url: null,
          error: true,
          loading: false,
        };
      }

      // Only show loading for truly new icons
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
      // Skip if we already have the right icon from initial state
      if (
        KNOWN_CHAIN_ICONS[chainId] &&
        iconUrl === KNOWN_CHAIN_ICONS[chainId]
      ) {
        return;
      }

      // Skip if we already have a cached icon
      if (
        imageDataCache.has(chainId) &&
        iconUrl === imageDataCache.get(chainId)
      ) {
        return;
      }

      // Check if we have a known local icon first
      if (KNOWN_CHAIN_ICONS[chainId]) {
        setIconUrl(KNOWN_CHAIN_ICONS[chainId]);
        setError(false);
        setIsLoading(false);
        return;
      }

      // For UTXO networks, skip ChainList fetching as they're not in ChainList
      if (networkKind === 'utxo') {
        if (!error) {
          setError(true);
          setIsLoading(false);
        }
        return;
      }

      // Check cache first - synchronous for instant display
      if (imageDataCache.has(chainId)) {
        const cachedUrl = imageDataCache.get(chainId);
        if (cachedUrl && cachedUrl !== iconUrl) {
          setIconUrl(cachedUrl);
          setError(false);
          setIsLoading(false);
        } else if (!cachedUrl && !error) {
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

    // Use Pali logo as fallback
    if (error || (!iconUrl && !isLoading)) {
      return (
        <div
          className={`relative flex items-center justify-center ${fallbackClassName} ${className}`}
          style={{ width: size, height: size }}
        >
          <img
            src={PaliLogo}
            alt={`Chain ${chainId}`}
            className="rounded-full opacity-30 grayscale"
            style={{ width: size, height: size }}
          />
          <span className="absolute text-[10px] font-bold text-white/80">
            {chainId}
          </span>
        </div>
      );
    }

    // Show loading state
    if (isLoading && !iconUrl) {
      return (
        <div
          className={`animate-pulse bg-gray-600 ${fallbackClassName} ${className}`}
          style={{ width: size, height: size }}
        />
      );
    }

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
