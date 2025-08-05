import { IVaultState, IOmittedVault, IOmmitedAccount } from 'state/vault/types';
import { IKeyringAccountState, KeyringAccountType } from 'types/network';

export const removeXprv = (account: IKeyringAccountState): IOmmitedAccount => {
  // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
  const { xprv, ...accountWithoutXprv } = account;

  return accountWithoutXprv;
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
