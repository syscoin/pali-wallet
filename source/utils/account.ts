import { browser } from 'webextension-polyfill-ts';

import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';

import store from 'state/store';
import { IVaultState, IOmittedVault, IOmmitedAccount } from 'state/vault/types';

export const getConnectedAccount = (): IKeyringAccountState => {
  const { sender } = browser.runtime.connect(window.location.port);
  if (!(sender && sender.id)) throw new Error('No connection');

  const { accounts } = store.getState().vault;
  const { accountId } = store.getState().dapp.whitelist[sender.id];

  const account = Object.values(accounts).find((acc) => acc.id === accountId);
  if (!account) throw new Error('Connected account not found');

  return account;
};

const _removeSensitiveDataFromAccounts = (accounts: {
  [id: number]: IKeyringAccountState;
}) => {
  const fieldsToRemove = ['xprv'];

  for (const account of Object.values(accounts)) {
    for (const field of fieldsToRemove) {
      delete account[field];
    }
  }

  return accounts as { [id: number]: IOmmitedAccount };
};

export const removeSensitiveDataFromVault = (vault: IVaultState) => {
  const accounts = _removeSensitiveDataFromAccounts(vault.accounts);

  const _vault = {
    ...vault,
    accounts,
  };

  return _vault as IOmittedVault;
};
