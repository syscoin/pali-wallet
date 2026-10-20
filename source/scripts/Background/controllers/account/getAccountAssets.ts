import type { IVaultState } from 'state/vault/types';

/** Keep each caller's family check at its existing admission or commit point. */
export const requireAssetArray = <T>(
  assets: T[] | undefined,
  family: 'Ethereum' | 'Syscoin'
): T[] => {
  if (!assets) throw new Error(`${family} assets array not initialized`);
  return assets;
};

/** Validate the supplied snapshot without changing when callers read state. */
export const getAccountAssets = (
  accountAssets: IVaultState['accountAssets'],
  account: IVaultState['activeAccount']
) => {
  if (!accountAssets) throw new Error('Account assets not initialized');
  const accounts = accountAssets[account.type];
  if (!accounts)
    throw new Error(
      `Account type '${account.type}' not found in accountAssets`
    );
  const assets = accounts[account.id];
  if (!assets)
    throw new Error(
      `Account ID '${account.id}' not found for account type '${account.type}'`
    );
  return assets;
};
