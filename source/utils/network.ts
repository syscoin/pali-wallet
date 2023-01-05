import {
  getBip44Chain,
  jsonRpcRequest,
  validateSysRpc,
} from '@pollum-io/sysweb3-network';

import store from 'state/store';

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
  store.getState().vault.isBitcoinBased ? 'syscoin' : 'ethereum';

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

// move to sysweb3
export const getUtxoRpc = async (url: string) => {
  const { valid, coin, chain } = await validateSysRpc(url);

  if (!valid) throw new Error('Invalid RPC');

  const { chainId } = getBip44Chain(coin, chain === 'test');

  return chainId;
};

export const validateRpc = async (url: string, isUtxo?: boolean) => {
  if (isUtxo) return await getUtxoRpc(url);

  return await jsonRpcRequest(url, 'eth_chainId');
};
