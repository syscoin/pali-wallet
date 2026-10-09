import { chromeStorage } from 'utils/storageAPI';

/** A failed or incomplete vault read must never offer to replace an existing wallet. */
export const readWalletPresence = async (): Promise<boolean> => {
  const [vault, keys] = await Promise.all([
    chromeStorage.getItem('sysweb3-vault'),
    chromeStorage.getItem('sysweb3-vault-keys'),
  ]);
  if (Boolean(vault) !== Boolean(keys)) {
    throw new Error(
      'Wallet storage is incomplete. Reload the wallet to retry.'
    );
  }
  return Boolean(vault && keys);
};
