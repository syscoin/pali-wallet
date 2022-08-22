import store from 'state/store';

export const isActiveNetwork = (chain: string, chainId: number) => {
  const { activeNetwork } = store.getState().vault;
  const activeChain = networkChain(activeNetwork);

  const isSameChain = chain === activeChain;
  const isSameChainId = activeNetwork.chainId === chainId;

  return isSameChain && isSameChainId;
};

/**
 * `{ chaindId, url }` is compatible with `INetwork`
 */
export const isSysNetwork = ({
  chainId,
  url,
}: {
  chainId: number;
  url: string;
}) => {
  const { networks } = store.getState().vault;
  return Boolean(networks.syscoin[chainId]) && url.includes('blockbook');
};

/**
 * `{ chaindId, url }` is compatible with `INetwork`
 */
export const networkChain = (network: { chainId: number; url: string }) =>
  isSysNetwork(network) ? 'syscoin' : 'ethereum';
