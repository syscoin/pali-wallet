import store from 'state/store';

export const isPollingRunNotValid = () => {
  const {
    isNetworkChanging,
    isLoadingTxs,
    isLoadingBalances,
    isLoadingAssets,
    changingConnectedAccount: { isChangingConnectedAccount },
    accounts,
    lastLogin,
  } = store.getState().vault;

  const verifyIfUserIsNotRegistered = lastLogin === 0;

  const hasAccount0Address = Boolean(accounts.HDAccount[0].address);

  return (
    !hasAccount0Address ||
    verifyIfUserIsNotRegistered ||
    isChangingConnectedAccount ||
    isLoadingAssets ||
    isLoadingBalances ||
    isLoadingTxs ||
    isNetworkChanging
  );
};
