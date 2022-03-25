import store from 'state/store';
import {
  IAccountState,
  ICopyAccountState,
  ICopyWalletState,
} from 'state/wallet/types';
import { browser } from 'webextension-polyfill-ts';

export const getConnectedAccount = (chain: string): IAccountState => {
  const { accounts } = store.getState().wallet;

  const { sender } = browser.runtime.connect(window.location.port);

  if (sender && sender.id) {
    const accountId =
      store.getState().dapp.whitelist[sender.id].accounts[chain];

    return accounts.find(
      (account) => account.id === accountId
    ) as IAccountState;
  }

  return {} as IAccountState;
};

const _getOmittedSensitiveAccountState = () => {
  const { accounts } = store.getState().wallet;

  const sensitiveData = ['xprv', 'connectedTo', 'web3PrivateKey'];

  for (const account of accounts) {
    sensitiveData.map((data: string) => {
      delete account[data];
    });
  }

  return accounts as ICopyAccountState[];
};

export const _getOmittedSensitiveState = () => {
  const accounts = _getOmittedSensitiveAccountState();

  const { wallet } = store.getState();

  const _wallet: ICopyWalletState = {
    ...wallet,
    accounts,
  };

  return _wallet;
};
