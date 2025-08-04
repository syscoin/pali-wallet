import {
  CustomJsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';

import { IAccountAssets } from 'state/vault/types';

import EvmAssetsController from './evm';
import SysAssetsController from './syscoin';
import { IAssetsManager, IAssetsManagerUtilsResponse } from './types';

const AssetsManager = (): IAssetsManager => {
  const updateAssetsFromCurrentAccount = async (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    activeNetworkUrl: string,
    networkChainId: number,
    web3Provider: CustomJsonRpcProvider,
    currentAssets: IAccountAssets
  ): Promise<IAssetsManagerUtilsResponse> => {
    switch (isBitcoinBased) {
      case true:
        const getSysAssets = await SysAssetsController().getSysAssetsByXpub(
          currentAccount.xpub,
          activeNetworkUrl,
          networkChainId
        );

        return {
          ...currentAssets,
          syscoin: getSysAssets,
        };

      case false:
        if (!web3Provider) {
          console.error('No valid web3Provider for EVM assets fetching');
          return {
            ...currentAssets,
            ethereum: [],
          };
        }

        // Create EVM controller fresh with current provider
        const assetsController = EvmAssetsController();
        const getEvmAssets = await assetsController.updateAllEvmTokens(
          currentAccount,
          networkChainId,
          web3Provider,
          currentAssets.ethereum || []
        );

        return {
          ...currentAssets,
          ethereum: getEvmAssets,
        };
    }
  };

  return {
    sys: SysAssetsController(),
    utils: {
      updateAssetsFromCurrentAccount,
    },
  };
};

export default AssetsManager;
