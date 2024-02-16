export const getChainIdPriority = (chainId) => {
  const chainIdOrder = [570, 57];

  const index = chainIdOrder.indexOf(chainId);
  return index !== -1 ? index : chainIdOrder.length;
};
