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
            networkChainId
          );

          const decodedSysAssets = getSysAssets.map((asset) => ({
            ...asset,
            symbol: decodeURIComponent(
              Array.prototype.map
                .call(
                  atob(asset.symbol),
                  (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                )
                .join('')
            ),
          }));

          return {
            ...currentAccount.assets,
            syscoin: decodedSysAssets,
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
