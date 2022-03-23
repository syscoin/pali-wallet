import store from 'state/store';
import { IAccountState } from 'state/wallet/types';
import { Runtime } from 'webextension-polyfill-ts';

export const getConnectedAccount = (port: Runtime.Port): IAccountState => {
  const { accounts } = store.getState().wallet;

  const { sender } = port;

  if (sender && sender.id) {
    const accountId =
      store.getState().dapp.whitelist[sender.id].accounts.Syscoin;

    return accounts.find(
      (account) => account.id === accountId
    ) as IAccountState;
  }

  return {} as IAccountState;
};
