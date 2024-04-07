import { ethers } from 'ethers';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import {
  INetworkType,
  validateEthRpc,
  validateSysRpc,
} from '@pollum-io/sysweb3-network';

import store from 'state/store';

import { ethTestnetsChainsIds } from './constants';

export const isActiveNetwork = (chain: string, chainId: number) => {
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

/**
 * `{ chaindId, url }` is compatible with `INetwork`
 */
export const isBitcoinBasedNetwork = async ({
  chainId,
  url,
}: {
  chainId: number;
  url: string;
}) => {
  try {
    const { networks } = store.getState().vault;

    const isSyscoinChain = Boolean(networks.syscoin[chainId]);

    if (!isSyscoinChain) return false;

    const { valid } = await validateSysRpc(url);

    return isSyscoinChain && valid;
  } catch (error) {
    return false;
  }
};

export const verifyIfIsTestnet = async (
  networkUrl: string,
  isBitcoinBased: boolean,
  isInCooldown: boolean
) => {
  const { chain, chainId }: any = isBitcoinBased
    ? await validateSysRpc(networkUrl)
    : await validateEthRpc(networkUrl, isInCooldown);

  return Boolean(
    chain === 'test' ||
      chain === 'testnet' ||
      ethTestnetsChainsIds.some(
        (validationChain) => validationChain === chainId
      )
  );
};

export const verifyNetworkEIP1559Compatibility = async (
  web3Provider: CustomJsonRpcProvider,
  stateBlock?: ethers.providers.Block
) => {
  try {
    const latestBlock = stateBlock
      ? stateBlock
      : await web3Provider.getBlock('latest');
    const baseFeePerGasExistInBlock = latestBlock?.baseFeePerGas !== undefined;
    let isCompatible = false;

    if (baseFeePerGasExistInBlock) {
      const isValidEIP1559Fee = Number(latestBlock.baseFeePerGas) !== 0;
      isCompatible = isValidEIP1559Fee;
    }

    return isCompatible;
  } catch (error) {
    throw new Error(error);
  }
};

export const getNetworkChain = (isBtcBased: boolean) =>
  isBtcBased ? INetworkType.Ethereum : INetworkType.Syscoin;
