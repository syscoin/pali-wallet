import { createFixedBrowserStateStorage } from '@sidhujag/sysweb3-core';
import { createKeyringHost } from '@sidhujag/sysweb3-keyring';

const VAULT = 'sysweb3-vault';
const KEYS = 'sysweb3-vault-keys';

export function createBrowserKeyringHost(storage: chrome.storage.StorageArea) {
  const fixed = createFixedBrowserStateStorage(storage);
  const get = storage.get.bind(storage);
  return createKeyringHost({
    ...fixed,
    async readDeviceUnlockVaultPair() {
      // One browser snapshot binds failed password accounting to the same
      // vault and salt even when the active network or session has changed.
      const records = await get([VAULT, KEYS]);
      const vault = records[VAULT];
      const keys = records[KEYS];
      if (
        (vault === undefined || vault === null) &&
        (keys === undefined || keys === null)
      )
        return null;
      if (typeof vault !== 'string' || keys === undefined || keys === null)
        throw new Error('Incomplete wallet vault pair');
      const bytes = new TextEncoder().encode(JSON.stringify({ vault, keys }));
      try {
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const pairFingerprint = Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('');
        return { vault, keys, pairFingerprint };
      } finally {
        bytes.fill(0);
      }
    },
  });
}
