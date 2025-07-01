import { isNil } from 'lodash';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import { ITokenSysProps, ISysAssetMetadata } from 'types/tokens';

import { ISysAssetsController, ISysTokensAssetReponse } from './types';
import { validateAndManageUserAssets, ensureTrailingSlash } from './utils';

const SysAssetsControler = (): ISysAssetsController => {
  // Cache for Syscoin asset metadata
  const assetCache = new Map<
    string,
    {
      data: ISysAssetMetadata;
      timestamp: number;
    }
  >();

  const ASSET_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache for asset metadata

  /**
   * Get cached asset data or fetch if not cached/expired
   */
  const getAssetCached = async (
    networkUrl: string,
    assetGuid: string
  ): Promise<ISysAssetMetadata | null> => {
    const cacheKey = `${networkUrl}::${assetGuid}`;
    const cached = assetCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if valid and not expired
    if (cached && now - cached.timestamp < ASSET_CACHE_DURATION) {
      console.log(
        `[SysAssetsController] Using cached asset data for ${assetGuid}`
      );
      return cached.data;
    }

    // Fetch fresh data
    try {
      console.log(
        `[SysAssetsController] Fetching fresh asset data for ${assetGuid}`
      );
      const assetData = await getAsset(networkUrl, assetGuid);

      // Cache the result
      assetCache.set(cacheKey, {
        data: assetData,
        timestamp: now,
      });

      return assetData;
    } catch (error) {
      console.error(
        `[SysAssetsController] Error fetching asset ${assetGuid}:`,
        error
      );
      throw error;
    }
  };
  const addSysDefaultToken = async (assetGuid: string, networkUrl: string) => {
    try {
      const metadata = await getAssetCached(networkUrl, assetGuid);

      if (!metadata) {
        throw new Error('Asset not found');
      }

      if (!metadata.symbol) {
        throw new Error('Asset has no symbol');
      }

      const sysAssetToAdd = {
        ...metadata,
        symbol: metadata.symbol, // Syscoin 5 uses plain text symbols
        balance: 0, // Initialize with 0, will be updated by asset refresh
      } as ITokenSysProps;

      return sysAssetToAdd;
    } catch (error) {
      console.error('addSysDefaultToken error:', error);
      throw error; // Re-throw to let caller handle
    }
  };

  const getSysAssetsByXpub = async (
    xpub: string,
    networkUrl: string,
    networkChainId: number
  ): Promise<ISysTokensAssetReponse[]> => {
    try {
      const requestOptions = 'details=tokenBalances&tokens=nonzero';

      const { tokens, tokensAsset } = await fetchBackendAccountCached(
        ensureTrailingSlash(networkUrl),
        xpub,
        requestOptions,
        true
      );

      //Validate to know which tokens use, for some cases the request only return tokens without tokensAsset
      //and for some other cases return both
      const isTokensAssetValid = tokensAsset && tokensAsset.length > 0;

      const validTokens = isTokensAssetValid ? tokensAsset : tokens;

      const preventUndefined =
        typeof validTokens === 'undefined' || validTokens === undefined
          ? []
          : validTokens;
      //We need to get only tokens that has AssetGuid property
      const getOnlyTokensWithAssetGuid: ISysTokensAssetReponse[] =
        preventUndefined.filter(
          (token: ISysTokensAssetReponse) => !isNil(token.assetGuid)
        );

      const filteredAssetsLength = getOnlyTokensWithAssetGuid.slice(0, 30);

      if (filteredAssetsLength && filteredAssetsLength.length > 0) {
        //Need to add chainId inside the asset object to we can validate it based on network connect
        //To show it on list and maintain correctly inside state
        const assetsWithChain = filteredAssetsLength.map((asset) => {
          if (asset.chainId && asset.chainId === networkChainId) return asset;

          return { ...asset, chainId: networkChainId };
        });

        const treatedAssets = validateAndManageUserAssets(
          false,
          assetsWithChain
        ) as ISysTokensAssetReponse[];
        // Syscoin 5 uses plain text symbols, no decoding needed
        return treatedAssets;
      }

      return [];
    } catch (error) {
      console.error('SysAssetsControler -> getSysAssetsByXpub -> error', error);
      return [];
    }
  };

  return {
    addSysDefaultToken,
    getSysAssetsByXpub,
    getAssetCached,
  };
};

export default SysAssetsControler;
