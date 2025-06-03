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
      const oldState = await new Promise<{ [key: string]: any }>((resolve) => {
        chrome.storage.local.get(oldStateName, resolve);
      });
      const newState = parseJsonRecursively(oldState[oldStateName] || '{}');

      await new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            'sysweb3-vault': vault,
            'sysweb3-vault-keys': vaultKeys,
            ...(Object.keys(newState).length && {
              [newStateName]: JSON.stringify(newState),
            }),
          },
          resolve
        );
      });

      await controllerEmitter(['rehydrate'], []);
    }
  } catch (error) {
    console.error('<!> Error migrating state', error);
  }
}
