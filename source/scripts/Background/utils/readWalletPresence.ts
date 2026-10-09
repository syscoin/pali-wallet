import { chromeStorage } from 'utils/storageAPI';

/** A failed or incomplete vault read must never offer to replace an existing wallet. */
export const readWalletPresence = async (): Promise<boolean> => {
  const records = await chromeStorage.getItems([
    'sysweb3-vault',
    'sysweb3-vault-keys',
  ]);
  const vault = records['sysweb3-vault'];
  const keys = records['sysweb3-vault-keys'];
  const hasVault = vault !== null && vault !== undefined;
  const hasKeys = keys !== null && keys !== undefined;
  if (hasVault !== hasKeys) {
    throw new Error(
      'Wallet storage is incomplete. Reload the wallet to retry.'
    );
  }
  return hasVault && hasKeys;
};
