import { INetworksVault, IPaliAccount } from 'state/vault/types';

import EvmAssetsController from './evm';
import SysAssetsController from './syscoin';
import { IAssetsManager, IAssetsManagerUtilsResponse } from './types';

const AssetsManager = (): IAssetsManager => {
  const updateAssetsFromCurrentAccount = async (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    activeNetworkUrl: string,
    networkChainId: number,
    networks: INetworksVault
  ): Promise<IAssetsManagerUtilsResponse> => {
    switch (isBitcoinBased) {
      case true:
        try {
          const getSysAssets = await SysAssetsController().getSysAssetsByXpub(
            currentAccount.xpub,
            activeNetworkUrl,
            networkChainId,
            currentAccount.assets.syscoin
          );

          return {
            ...currentAccount.assets,
            syscoin: getSysAssets,
          };
        } catch (sysUpdateError) {
          return sysUpdateError;
        }

      case false:
        try {
          const getEvmAssets = await EvmAssetsController().updateAllEvmTokens(
            currentAccount,
            networks
          );

          return {
            ...currentAccount.assets,
            ethereum: getEvmAssets,
          };
        } catch (evmUpdateError) {
          return evmUpdateError;
        }
    }
  };

  return {
    evm: EvmAssetsController(),
    sys: SysAssetsController(),
    utils: {
      updateAssetsFromCurrentAccount,
    },
  };
};

export default AssetsManager;
