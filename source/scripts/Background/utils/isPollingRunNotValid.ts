import store from 'state/store';

export const isPollingRunNotValid = () => {
  const {
    networkStatus,
    changingConnectedAccount: { isChangingConnectedAccount },
    lastLogin,
  } = store.getState().vaultGlobal;

  const verifyIfUserIsNotRegistered = lastLogin === 0;

  const isNetworkChanging = networkStatus === 'switching';

  // Only block polling for critical operations, not loading states
  // We want to show loading indicators during polling now
  if (
    isNetworkChanging ||
    verifyIfUserIsNotRegistered ||
    isChangingConnectedAccount
  ) {
    return true;
  }

  return false;
};
