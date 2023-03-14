import { getAsset } from '@pollum-io/sysweb3-utils';

import { getController } from 'utils/browser';

const SysAssetsControler = (): ISysAssetsController => {
  const controller = getController();

  const addSysDefaultToken = async (assetGuid: string, networkUrl: string) => {
    try {
      const metadata = await getAsset(networkUrl, assetGuid);

      if (metadata && metadata.symbol) {
        await controller.wallet.account.sys.saveTokenInfo({
          ...metadata,
          symbol: metadata.symbol ? atob(String(metadata.symbol)) : '',
        });

        return true;
      }
    } catch (error) {
      return false;
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
  ) => Promise<boolean>;
}

export default SysAssetsControler;
