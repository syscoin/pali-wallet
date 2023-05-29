import concat from 'lodash/concat';
import isNil from 'lodash/isNil';
import sys from 'syscoinjs-lib';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { ITokenSysProps } from 'types/tokens';

import { ISysAssetsController, ISysTokensAssetReponse } from './types';
import { validateAndManageUserAssets } from './utils';

const SysAssetsControler = (): ISysAssetsController => {
  const addSysDefaultToken = async (assetGuid: string, networkUrl: string) => {
    try {
      const metadata = await getAsset(networkUrl, assetGuid);

      if (metadata && metadata.symbol) {
        const sysAssetToAdd = {
          ...metadata,
          symbol: metadata.symbol
            ? decodeURIComponent(
                Array.prototype.map
                  .call(
                    atob(metadata.symbol),
                    (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                  )
                  .join('')
              )
            : '',
        } as ITokenSysProps;

        return sysAssetToAdd;
      }
    } catch (error) {
      return Boolean(error);
    }
  };

  const getSysAssetsByXpub = async (
    xpub: string,
    networkUrl: string,
    networkChainId: number,
    currentAssetsInState?: ISysTokensAssetReponse[]
  ): Promise<ISysTokensAssetReponse[]> => {
    try {
      const requestOptions = 'details=tokenBalances&tokens=nonzero';

      const { tokens, tokensAsset } = await sys.utils.fetchBackendAccount(
        networkUrl,
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

        const decodedSysAssets = assetsWithChain.map((asset) => ({
          ...asset,
          symbol: asset.symbol
            ? decodeURIComponent(
                Array.prototype.map
                  .call(
                    atob(asset.symbol),
                    (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                  )
                  .join('')
              )
            : '',
        }));

        const assetsToTreat: ISysTokensAssetReponse[] =
          currentAssetsInState.length > 0
            ? concat(decodedSysAssets, currentAssetsInState)
            : assetsWithChain;

        const treatedAssets = validateAndManageUserAssets(
          false,
          assetsToTreat
        ) as ISysTokensAssetReponse[];

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
