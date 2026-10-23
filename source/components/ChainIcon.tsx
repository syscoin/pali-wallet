/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ArbitrumIcon from '../assets/all_assets/arbitrum-icon.svg';
import BaseIcon from '../assets/all_assets/base-icon.svg';
import ZkSysIcon from '../assets/all_assets/zksys-icon.svg';
import {
  BtcChainSvg,
  ChainFallbackSvg,
  EthChainSvg,
  RolluxChainSvg,
  SysChainSvg,
} from 'components/Icon/Icon';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { INetworkType } from 'types/network';

// Cache for actual image data URLs (base64) to prevent any network requests
const imageDataCache = new Map<string, string | null>();

// Track in-flight requests to prevent duplicate fetches
const pendingRequests = new Map<string, Promise<string | null>>();

/**
 * Simple Cache Strategy:
 *
 * imageDataCache: Maps network family + chainId to image data or null if failed
 * - Key: network family + chainId (numeric IDs can overlap across families)
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
  [family: string]: {
    [chainId: number]:
      | React.ComponentType<{ className?: string; style?: React.CSSProperties }>
      | string;
  };
} = {
  ethereum: {
    1: EthChainSvg, // Ethereum Mainnet
    5: EthChainSvg, // Ethereum Goerli (testnet)
    11155111: EthChainSvg, // Ethereum Sepolia (testnet)
    57: SysChainSvg, // Syscoin NEVM Mainnet
    5700: SysChainSvg, // Syscoin NEVM Testnet
    57057: ZkSysIcon, // zkTanenbaum Testnet
    570: RolluxChainSvg, // Rollux Mainnet
    57000: RolluxChainSvg, // Rollux Testnet
    8453: BaseIcon, // Base Mainnet
    42161: ArbitrumIcon, // Arbitrum One
  },
  // UTXO chain IDs from coins.ts.
  syscoin: {
    0: BtcChainSvg, // Bitcoin Mainnet (slip44: 0)
    1: BtcChainSvg, // Bitcoin Testnet (chainId: 1)
    57: SysChainSvg, // Syscoin UTXO Mainnet (slip44: 57)
    5700: SysChainSvg, // Syscoin Testnet (chainId: 5700)
    10000: BtcChainSvg, // Bitcoin Regtest (chainId: 10000)
  },
};

// Helper function to get icon with fallback
const getKnownIcon = (chainId: number, networkKind?: INetworkType) => {
  const networkType =
    networkKind === INetworkType.Ethereum ? 'ethereum' : 'syscoin';
  return KNOWN_CHAIN_ICONS[networkType][chainId] || null;
};

interface IIconScope {
  chainId: number;
  key: string;
  networkKind?: INetworkType;
  revision: number;
}

const initialIconState = (scope: IIconScope) => {
  const known = getKnownIcon(scope.chainId, scope.networkKind);
  return {
    scope,
    // An undefined URL is loading; null is the fallback. Local SVG components
    // are derived from the current scope, never retained in async state.
    url: known
      ? typeof known === 'string'
        ? known
        : null
      : imageDataCache.get(scope.key),
  };
};

const fetchIcon = async (scope: IIconScope): Promise<string | null> => {
  try {
    const chainInfo = (await controllerEmitter(
      ['wallet', 'getChainById'],
      [scope.chainId, scope.networkKind]
    )) as { chainSlug?: string; icon?: string; shortName?: string } | null;
    const iconIdentifier =
      chainInfo?.icon || chainInfo?.chainSlug || chainInfo?.shortName;
    if (iconIdentifier) {
      const iconUrls = [
        `https://c1.coinlore.com/img/25x25/${iconIdentifier}.png`,
        `https://coinlore.com/img/${iconIdentifier}.png`,
        `https://icons.llamao.fi/icons/chains/rsz_${iconIdentifier}.jpg`,
        `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${iconIdentifier}/info/logo.png`,
      ];
      for (const url of iconUrls) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const blob = await response.blob();
          const dataUrl = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
          imageDataCache.set(scope.key, dataUrl);
          return dataUrl;
        } catch {
          // Keep the existing ordered fallbacks for a refused image source.
        }
      }
    }
  } catch (fetchError) {
    console.error('Error fetching chain icon:', fetchError);
  }
  imageDataCache.set(scope.key, null);
  return null;
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
    const { t } = useTranslation();
    // Keep omitted-kind callers' existing lookup behavior, without letting
    // their result poison an explicitly selected network family's cache.
    const key = `${networkKind ?? 'unspecified'}:${chainId}`;
    const scopeRef = useRef<IIconScope>();
    if (scopeRef.current?.key !== key) {
      scopeRef.current = {
        key,
        chainId,
        networkKind,
        revision: (scopeRef.current?.revision ?? -1) + 1,
      };
    }
    const scope = scopeRef.current!;
    const [state, setState] = useState(() => initialIconState(scope));
    // Scope changes must not render the previous SVG/image while passive
    // effects catch up. The revision also distinguishes A -> B -> A.
    const known = getKnownIcon(chainId, networkKind);
    const iconComponent = typeof known === 'string' ? null : known;
    const { url: iconUrl } =
      state.scope === scope ? state : initialIconState(scope);
    const dimensions = { width: size, height: size };

    useEffect(() => {
      let active = true;
      const initial = initialIconState(scope);
      setState(initial);
      const commit = (url: string | null) => {
        if (active && scopeRef.current === scope) {
          setState({ scope, url });
        }
      };
      let loadTimer: ReturnType<typeof setTimeout>;
      if (initial.url === undefined) {
        const load = () => {
          if (imageDataCache.has(scope.key)) {
            commit(imageDataCache.get(scope.key)!);
            return;
          }
          let promise = pendingRequests.get(scope.key);
          if (!promise) {
            promise = fetchIcon(scope);
            pendingRequests.set(scope.key, promise);
            const ownedPromise = promise;
            void promise.then(() => {
              if (pendingRequests.get(scope.key) === ownedPromise) {
                pendingRequests.delete(scope.key);
              }
            });
          }
          void promise.then(commit);
        };
        if (pendingRequests.has(scope.key)) load();
        else loadTimer = setTimeout(load, 50);
      }
      return () => {
        active = false;
        clearTimeout(loadTimer);
      };
    }, [scope]);

    // Use fallback SVG for unknown chains
    if (iconUrl !== undefined && !iconUrl && !iconComponent) {
      return (
        <ChainFallbackSvg
          className={`${fallbackClassName} ${className}`}
          style={dimensions}
          chainId={chainId}
        />
      );
    }

    // Show loading state
    if (iconUrl === undefined) {
      return (
        <div
          className={`animate-pulse bg-gray-600 ${fallbackClassName} ${className}`}
          style={dimensions}
        />
      );
    }

    // Render SVG component if available
    if (iconComponent) {
      const IconComponent = iconComponent;
      return (
        <div style={dimensions} className={className}>
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
        key={scope.revision}
        src={iconUrl}
        alt={t('components.chainWithId', { chainId })}
        className={`rounded-full ${className}`}
        style={dimensions}
        onError={() => {
          if (scopeRef.current === scope) {
            setState({ scope, url: null });
          }
        }}
      />
    );
  }
);

ChainIcon.displayName = 'ChainIcon';
