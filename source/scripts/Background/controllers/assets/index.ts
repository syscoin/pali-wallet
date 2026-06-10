import {
  CustomJsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';

import { IAccountAssets } from 'state/vault/types';
import { CHAIN_IDS } from 'utils/constants';

import EvmAssetsController from './evm';
import SysAssetsController from './syscoin';
import { IAssetsManager, IAssetsManagerUtilsResponse } from './types';

// SPT assets only exist on Syscoin UTXO chains; other UTXO networks
// (e.g. Bitcoin) have no token layer, so skip the Blockbook token call there.
const SPT_CAPABLE_UTXO_CHAIN_IDS = new Set<number>([
  CHAIN_IDS.SYSCOIN_MAINNET,
  CHAIN_IDS.SYSCOIN_TESTNET,
]);

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
        if (!SPT_CAPABLE_UTXO_CHAIN_IDS.has(networkChainId)) {
          // Non-Syscoin UTXO chain (e.g. BTC): no SPT tokens to fetch
          return { ...currentAssets };
        }

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
