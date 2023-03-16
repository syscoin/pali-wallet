import sys from 'syscoinjs-lib';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { ITokenSysProps } from 'types/tokens';

import { ISysAssetsController, ITokensAssetReponse } from './types';

const SysAssetsControler = (): ISysAssetsController => {
  const addSysDefaultToken = async (assetGuid: string, networkUrl: string) => {
    try {
      const metadata = await getAsset(networkUrl, assetGuid);

      if (metadata && metadata.symbol) {
        const sysAssetToAdd = {
          ...metadata,
          symbol: metadata.symbol ? atob(String(metadata.symbol)) : '',
        } as ITokenSysProps;

        return sysAssetToAdd;
      }
    } catch (error) {
      return Boolean(error);
    }
  };

  const getSysAssetsByXpub = async (
    xpub: string,
    networkUrl: string
  ): Promise<ITokensAssetReponse[]> => {
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
      const validateTokenAssets =
        tokensAsset && tokensAsset.length > 0 ? tokensAsset : tokens;

      const filteredAssetsLength: ITokensAssetReponse[] = validateTokenAssets
        ? validateTokenAssets.slice(0, 30)
        : [];

      return filteredAssetsLength;
    } catch (error) {
      console.log('assets by xpub error', error);
      return error;
    }
  };

  return {
    addSysDefaultToken,
    getSysAssetsByXpub,
  };
};

export default SysAssetsControler;
