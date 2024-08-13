import { parseJsonRecursively } from 'utils/format';

import { rehydrateStore } from './rehydrate';
import store from './store';

export async function migrateWalletState(
  oldStateName: string,
  newStateName: string,
  hasAccount: boolean
) {
  try {
    const vault = JSON.parse(localStorage.getItem('sysweb3-vault'));
    const vaultKeys = JSON.parse(localStorage.getItem('sysweb3-vault-keys'));

    if (vault && vaultKeys && !hasAccount) {
      const oldState = await chrome.storage.local.get(oldStateName);
      const newState = parseJsonRecursively(oldState[oldStateName] || '{}');

      console.log(oldState, 'oldState');

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
