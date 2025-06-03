import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import { IPaliAccount } from 'state/vault/types';

import EvmAssetsController from './evm';
import SysAssetsController from './syscoin';
import { IAssetsManager, IAssetsManagerUtilsResponse } from './types';

const AssetsManager = (w3Provider: CustomJsonRpcProvider): IAssetsManager => {
  const evmAssetsController = EvmAssetsController(w3Provider);
  const updateAssetsFromCurrentAccount = async (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    activeNetworkUrl: string,
    networkChainId: number
  ): Promise<IAssetsManagerUtilsResponse> => {
    switch (isBitcoinBased) {
      case true:
        try {
          // Check if the xpub is valid for UTXO (not an Ethereum public key)
          if (currentAccount.xpub && currentAccount.xpub.startsWith('0x')) {
            console.error(
              'Invalid xpub for UTXO network - account has Ethereum public key instead of Bitcoin xpub'
            );
            // Return empty assets for invalid xpub
            return {
              ...currentAccount.assets,
              syscoin: [],
            };
          }

          const getSysAssets = await SysAssetsController().getSysAssetsByXpub(
            currentAccount.xpub,
            activeNetworkUrl,
            networkChainId
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
          const getEvmAssets = await evmAssetsController.updateAllEvmTokens(
            currentAccount,
            networkChainId
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
    evm: evmAssetsController,
    sys: SysAssetsController(),
    utils: {
      updateAssetsFromCurrentAccount,
    },
  };
};

export default AssetsManager;
