import { Block } from '@ethersproject/providers';

import store from 'state/store';
import { INetworkType } from 'types/network';

export const isActiveNetwork = (chain: INetworkType, chainId: number) => {
  const { activeNetwork } = store.getState().vault;
  const activeChain = networkChain();

  const isSameChain = chain === activeChain;
  const isSameChainId = activeNetwork.chainId === chainId;

  return isSameChain && isSameChainId;
};

/**
 * `{ chaindId, url }` is compatible with `INetwork`
 */
export const networkChain = () =>
  getNetworkChain(store.getState().vault.isBitcoinBased);

export const verifyNetworkEIP1559Compatibility = async (stateBlock?: Block) => {
  try {
    // We should always have a block from state
    // Components are updated to only call this when currentBlock is available
    if (!stateBlock) {
      console.warn(
        'verifyNetworkEIP1559Compatibility called without stateBlock'
      );
      return false;
    }

    const baseFeePerGasExistInBlock = stateBlock.baseFeePerGas !== undefined;
    let isCompatible = false;

    if (baseFeePerGasExistInBlock) {
      const isValidEIP1559Fee = Number(stateBlock.baseFeePerGas) !== 0;
      isCompatible = isValidEIP1559Fee;
    }

    return isCompatible;
  } catch (error) {
    console.error('Failed to verify EIP1559 compatibility:', error);
    // Return false if we can't determine compatibility
    return false;
  }
};

export const getNetworkChain = (isBtcBased: boolean) =>
  isBtcBased ? INetworkType.Syscoin : INetworkType.Ethereum;
