import { browser } from 'webextension-polyfill-ts';

import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';

import store from 'state/store';
import { IVaultState, IOmittedVault, IOmmitedAccount } from 'state/vault/types';

export const getConnectedAccount = (): IKeyringAccountState | null => {
  const { sender } = browser.runtime.connect(window.location.port);
  if (!(sender && sender.id)) return null;

  const { accounts } = store.getState().vault;
  const { accountId } = store.getState().dapp.whitelist[sender.id];

  const account = Object.values(accounts).find((acc) => acc.id === accountId);

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
