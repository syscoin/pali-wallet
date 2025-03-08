import { initialNetworksState } from '@pollum-io/sysweb3-keyring/types/initial-state';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { parseJsonRecursively } from 'utils/format';

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

      // Apply the new migration
      if (
        newState.vault &&
        newState.vault.networks &&
        newState.vault.networks.ethereum
      ) {
        delete newState.vault.networks.ethereum[80001];
      }

      await chrome.storage.local.set({
        'sysweb3-vault': vault,
        'sysweb3-vault-keys': vaultKeys,
        ...(Object.keys(newState).length && {
          [newStateName]: JSON.stringify(newState),
        }),
      });

      await controllerEmitter(['rehydrate'], []);
    }
  } catch (error) {
    console.error('<!> Error migrating state', error);
  }
}
