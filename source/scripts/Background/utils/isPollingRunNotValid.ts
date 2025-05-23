import store from 'state/store';

export const isPollingRunNotValid = () => {
  const {
    networkStatus,
    isLoadingTxs,
    isLoadingBalances,
    isLoadingAssets,
    isLoadingNfts,
    changingConnectedAccount: { isChangingConnectedAccount },
    lastLogin,
  } = store.getState().vault;

  const verifyIfUserIsNotRegistered = lastLogin === 0;

  const isNetworkChanging = networkStatus === 'switching';

  if (
    isNetworkChanging ||
    isLoadingTxs ||
    isLoadingBalances ||
    isLoadingAssets ||
    isLoadingNfts ||
    verifyIfUserIsNotRegistered ||
    isChangingConnectedAccount
  ) {
    return true;
  }

  return false;
};
