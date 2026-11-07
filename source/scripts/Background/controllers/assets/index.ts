import {
  CustomJsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';

import { supportsSptUtxoChain } from '../../../../shared/sptInventory';
import { IAccountAssets } from 'state/vault/types';
import { ITokenEthProps } from 'types/tokens';

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
    currentAssets: IAccountAssets,
    onBalanceRead?: (token: ITokenEthProps) => void
  ): Promise<IAssetsManagerUtilsResponse> => {
    switch (isBitcoinBased) {
      case true:
        if (!supportsSptUtxoChain(networkChainId)) {
          // Non-Syscoin UTXO chain (e.g. BTC): no SPT tokens to fetch
          return { ...currentAssets };
        }

        const getSysAssets = await SysAssetsController().getSysAssetsByXpub(
          currentAccount.xpub,
          activeNetworkUrl,
          networkChainId,
          currentAssets.syscoin.filter(
            (asset) => asset.chainId === networkChainId
          )
        );

        return {
          ...currentAssets,
          syscoin: [
            ...getSysAssets,
            ...currentAssets.syscoin.filter(
              (asset) => asset.chainId !== networkChainId
            ),
          ],
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
          currentAssets.ethereum || [],
          onBalanceRead
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
