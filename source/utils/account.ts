import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import {
  IVaultState,
  IOmittedVault,
  IOmittedAccount,
  IPaliAccount,
} from 'state/vault/types';

export const removeXprv = (account: IPaliAccount): IOmittedAccount => {
  // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
  const { xprv, ...remainingInfo } = account;

  return remainingInfo;
};

export const removeSensitiveDataFromVault = (
  vault: IVaultState
): IOmittedVault => {
  const accounts = {};

  for (const account of Object.values(vault.accounts.HDAccount)) {
    accounts[KeyringAccountType.HDAccount][account.id] = removeXprv(account);
  }
  for (const account of Object.values(vault.accounts.Imported)) {
    accounts[KeyringAccountType.Imported][account.id] = removeXprv(account);
  }

  return {
    ...vault,
    accounts,
  };
};
