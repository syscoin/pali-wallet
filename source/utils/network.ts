import store from 'state/store';

export const isActiveNetwork = (chain: string, chainId: number) => {
  const { activeNetwork } = store.getState().vault;
  const isSysCore = activeNetwork.url.includes('blockbook');
  const activeChain = isSysCore ? 'syscoin' : 'ethereum';

  const isSameChain = chain === activeChain;
  const isSameChainId = activeNetwork.chainId === chainId;

  return isSameChain && isSameChainId;
};
