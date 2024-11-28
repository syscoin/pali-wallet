import { handleLogout } from 'scripts/Background/utils/handleLogout';
import store from 'state/store';

export const restartLockTimeout = (timeout: any, walletMethods: any) => {
  const { timer } = store.getState().vault;

  if (timeout) {
    clearTimeout(timeout);
  }

  return setTimeout(() => {
    handleLogout(walletMethods);
  }, timer * 60 * 1000);
};
