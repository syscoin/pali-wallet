import { getAsset } from '@pollum-io/sysweb3-utils';

import { ITokenSysProps } from 'types/tokens';

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

  return {
    addSysDefaultToken,
  };
};

export interface ISysAssetsController {
  addSysDefaultToken: (
    assetGuid: string,
    networkUrl: string
  ) => Promise<boolean | ITokenSysProps>;
}

export default SysAssetsControler;
