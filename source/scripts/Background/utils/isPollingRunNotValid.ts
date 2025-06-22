import store from 'state/store';

export const isPollingRunNotValid = () => {
  const {
    networkStatus,
    changingConnectedAccount: { isChangingConnectedAccount },
    lastLogin,
    loadingStates: {
      isLoadingTxs,
      isLoadingBalances,
      isLoadingAssets,
      isLoadingNfts,
    },
  } = store.getState().vaultGlobal;

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
