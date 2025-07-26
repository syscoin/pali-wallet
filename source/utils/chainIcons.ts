import { retryableFetch } from '@sidhujag/sysweb3-network';

import ChainListService from 'scripts/Background/controllers/chainlist';

// Cache for chain icons to avoid repeated lookups
const chainIconCache: { [chainId: number]: string | null } = {};
// Track failed icon loads to prevent repeated 404s
const failedIconLoads = new Set<number>();

/**
 * Get chain icon URL from ChainList data with multiple fallback sources
 * @param chainId - The chain ID to get icon for
 * @returns Promise<string | null> - The icon URL or null if not found
 */
export const getChainIconUrl = async (
  chainId: number
): Promise<string | null> => {
  // Check cache first
  if (chainId in chainIconCache) {
    return chainIconCache[chainId];
  }

  // Skip if we already know this icon doesn't exist
  if (failedIconLoads.has(chainId)) {
    return null;
  }

  try {
    const chainList = ChainListService.getInstance();
    const chain = await chainList.getChainById(chainId);

    if (chain) {
      // Try multiple icon sources in order of preference
      const iconSources = [
        // Primary source from ChainList using icon field
        chain.icon
          ? `https://icons.llamao.fi/icons/chains/rsz_${chain.icon}.jpg`
          : null,
        // Try chainSlug field for llamao icons (this often works when icon fails)
        chain.chainSlug
          ? `https://icons.llamao.fi/icons/chains/rsz_${chain.chainSlug}.jpg`
          : null,
        // TrustWallet assets using chainSlug
        chain.chainSlug
          ? `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain.chainSlug}/info/logo.png`
          : null,
      ].filter(Boolean) as string[];

      for (const iconUrl of iconSources) {
        try {
          const response = await retryableFetch(iconUrl, { method: 'HEAD' });
          if (response.ok) {
            chainIconCache[chainId] = iconUrl;
            return iconUrl;
          }
        } catch (error) {
          // Continue to next source
          continue;
        }
      }

      // All sources failed
      failedIconLoads.add(chainId);
    }
  } catch (error) {
    console.error(`Failed to get chain info for chainId ${chainId}:`, error);
  }

  // Cache null result to avoid repeated failed lookups
  chainIconCache[chainId] = null;
  failedIconLoads.add(chainId);
  return null;
};

/**
 * Get chain icon URL synchronously from cache (must be pre-loaded)
 * @param chainId - The chain ID to get icon for
 * @returns string | null - The cached icon URL or null
 */
export const getChainIconUrlSync = (chainId: number): string | null =>
  chainIconCache[chainId] || null;
