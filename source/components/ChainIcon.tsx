/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react';

import { INetworkType } from '@pollum-io/sysweb3-network';

import {
  BtcChainSvg,
  ChainFallbackSvg,
  EthChainSvg,
  RolluxChainSvg,
  SysChainSvg,
} from 'components/Icon/Icon';
import ChainListService from 'scripts/Background/controllers/chainlist';

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
  networkKind?: INetworkType;
  size?: number | string;
}

// Known chain icons with chainId and network type
const KNOWN_CHAIN_ICONS: {
  [key: string]:
    | React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    | string;
} = {
  // Ethereum networks (chainId-networkType)
  '1-ethereum': EthChainSvg, // Ethereum Mainnet
  '5-ethereum': EthChainSvg, // Ethereum Goerli (testnet)
  '11155111-ethereum': EthChainSvg, // Ethereum Sepolia (testnet)
  '57-ethereum': SysChainSvg, // Syscoin NEVM Mainnet
  '5700-ethereum': SysChainSvg, // Syscoin NEVM Testnet
  '570-ethereum': RolluxChainSvg, // Rollux Mainnet
  '57000-ethereum': RolluxChainSvg, // Rollux Testnet

  // UTXO networks (chainId-networkType) - using chainId from coins.ts
  '0-syscoin': BtcChainSvg, // Bitcoin Mainnet (slip44: 0)
  '1-syscoin': BtcChainSvg, // Bitcoin Testnet (chainId: 1)
  '57-syscoin': SysChainSvg, // Syscoin UTXO Mainnet (slip44: 57)
  '5700-syscoin': SysChainSvg, // Syscoin Testnet (chainId: 5700)
  '10000-syscoin': BtcChainSvg, // Bitcoin Regtest (chainId: 10000)
};

// Helper function to get icon with fallback
const getKnownIcon = (chainId: number, networkKind?: INetworkType) => {
  const networkType =
    networkKind === INetworkType.Ethereum ? 'ethereum' : 'syscoin';
  const iconKey = `${chainId}-${networkType}`;
  return KNOWN_CHAIN_ICONS[iconKey] || null;
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
  }) => {
    // Determine initial state based on what we already know
    const getInitialState = () => {
      // Check for known local icons using smart lookup
      const knownIcon = getKnownIcon(chainId, networkKind);
      if (knownIcon) {
        return {
          url: typeof knownIcon === 'string' ? knownIcon : null,
          component: typeof knownIcon !== 'string' ? knownIcon : null,
          error: false,
          loading: false,
        };
      }

      // Check cache for networks
      if (imageDataCache.has(chainId)) {
        const cached = imageDataCache.get(chainId);
        return {
          url: cached,
          component: null,
          error: cached === null,
          loading: false, // Never show loading for cached items
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
      // Check for known local icons using smart lookup
      const knownIcon = getKnownIcon(chainId, networkKind);
      if (knownIcon) {
        if (typeof knownIcon === 'string') {
          if (iconUrl !== knownIcon) {
            setIconUrl(knownIcon);
            setIconComponent(null);
            setError(false);
            setIsLoading(false);
          }
        } else {
          if (iconComponent !== knownIcon) {
            setIconUrl(null);
            setIconComponent(knownIcon);
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

      // Lazy load with delay to prevent blocking renderer
      const loadTimer = setTimeout(async () => {
        try {
          // Use ChainListService to look up icon data
          const chainListService = ChainListService.getInstance();
          const chainInfo = await chainListService.getChainById(
            chainId,
            networkKind
          );

          // Try to get icon identifier from chainInfo
          const iconIdentifier =
            chainInfo?.icon || chainInfo?.chainSlug || chainInfo?.shortName;

          if (iconIdentifier) {
            // Try different icon sources based on the icon data
            const iconUrls = [
              // CoinLore - has excellent coverage for major chains like Arbitrum
              `https://c1.coinlore.com/img/25x25/${iconIdentifier}.png`,
              // Alternative CoinLore format
              `https://coinlore.com/img/${iconIdentifier}.png`,
              // Llamao (works for many coins)
              `https://icons.llamao.fi/icons/chains/rsz_${iconIdentifier}.jpg`,
              // TrustWallet assets (backup)
              `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${iconIdentifier}/info/logo.png`,
            ];

            const tryIconUrl = (index: number) => {
              if (index >= iconUrls.length) {
                // All icon sources failed, cache as null and show fallback
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

          // ChainListService doesn't have this chain, cache as null and show fallback
          imageDataCache.set(chainId, null);
          setError(true);
          setIsLoading(false);
        } catch (fetchError) {
          console.error(
            'Error looking up chain in ChainListService:',
            fetchError
          );
          // Cache as null and show fallback
          imageDataCache.set(chainId, null);
          setError(true);
          setIsLoading(false);
        }
      }, 50); // Reduced from 150ms to 50ms for better UX while still preventing blocking

      return () => {
        clearTimeout(loadTimer);
      };
    }, [chainId, networkKind]);

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
    prevProps.networkKind === nextProps.networkKind
);

ChainIcon.displayName = 'ChainIcon';
