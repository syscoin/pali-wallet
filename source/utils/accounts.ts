import store from 'state/store';
import IWalletState, {
  IAccountState,
  ICopyAccountState,
  ICopyWalletState,
} from 'state/wallet/types';
import { browser } from 'webextension-polyfill-ts';

export const getConnectedAccount = (): IAccountState => {
  const { accounts } = store.getState().wallet;

  const { sender } = browser.runtime.connect(window.location.port);

  if (sender && sender.id) {
    const { accountId } = store.getState().dapp.whitelist[sender.id];

    const account = accounts.find(
      (account) => account.id === accountId
    ) as IAccountState;

    console.log('connected account', account);

    return account;
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

export const _getOmittedSensitiveState = (wallet: IWalletState) => {
  const accounts = _getOmittedSensitiveAccountState();

  const _wallet: ICopyWalletState = {
    ...wallet,
    accounts,
  };

  return _wallet;
};
