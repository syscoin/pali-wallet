import { validateSysRpc } from '@pollum-io/sysweb3-network';

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
