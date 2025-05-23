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
 * `{ chaindId, url }` is compatible with `INetworkWithKind`
 */
export const networkChain = () =>
  getNetworkChain(store.getState().vault.isBitcoinBased);

/**
 * `{ chaindId, url }` is compatible with `INetworkWithKind`
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
  isInCooldown: boolean,
  networkObject?: { chainId?: number; isTestnet?: boolean }
) => {
  // First, check if we have the network object with isTestnet property
  if (networkObject?.isTestnet !== undefined) {
    console.log(
      `verifyIfIsTestnet: Using network object isTestnet property: ${networkObject.isTestnet}`
    );
    return networkObject.isTestnet;
  }

  // Second, check against known testnet chain IDs without making RPC calls
  if (networkObject?.chainId) {
    const isKnownTestnet = ethTestnetsChainsIds.some(
      (validationChain) => validationChain === networkObject.chainId
    );
    if (isKnownTestnet) {
      console.log(
        `verifyIfIsTestnet: Chain ID ${networkObject.chainId} is a known testnet`
      );
      return true;
    }
  }

  // Fallback: Make RPC call only if we can't determine from static data
  console.log(
    `verifyIfIsTestnet: Making RPC call as fallback for ${networkUrl}`
  );
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
  isBtcBased ? INetworkType.Syscoin : INetworkType.Ethereum;
