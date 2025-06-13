import { isNil } from 'lodash';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import { ITokenSysProps } from 'types/tokens';

import { ISysAssetsController, ISysTokensAssetReponse } from './types';
import { validateAndManageUserAssets, ensureTrailingSlash } from './utils';

const SysAssetsControler = (): ISysAssetsController => {
  const addSysDefaultToken = async (assetGuid: string, networkUrl: string) => {
    try {
      const metadata = await getAsset(networkUrl, assetGuid);

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
  };
};

export default SysAssetsControler;
