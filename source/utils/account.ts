import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { IVaultState, IOmittedVault, IOmmitedAccount } from 'state/vault/types';

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
