import { getController } from 'scripts/Background';
import { parseJsonRecursively } from 'utils/format';

import { rehydrateStore } from './rehydrate';
import store from './store';

export async function migrateWalletState(
  oldStateName: string,
  newStateName: string
) {
  try {
    const { wallet } = getController();
    const vault = JSON.parse(localStorage.getItem('sysweb3-vault'));
    const vaultKeys = JSON.parse(localStorage.getItem('sysweb3-vault-keys'));
    const hasAccount = !!wallet.getActiveAccount().activeAccount.address;

    if (vault && vaultKeys && !hasAccount) {
      const oldState = await chrome.storage.local.get(oldStateName);
      const newState = parseJsonRecursively(oldState[oldStateName] || '{}');

      await chrome.storage.local.set({
        'sysweb3-vault': vault,
        'sysweb3-vault-keys': vaultKeys,
        ...(Object.keys(newState).length && {
          [newStateName]: JSON.stringify(newState),
        }),
      });

      await rehydrateStore(store);
    }
  } catch (error) {
    console.error('<!> Error migrating state', error);
  }
}
