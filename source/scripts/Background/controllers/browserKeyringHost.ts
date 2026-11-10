import { createFixedBrowserStateStorage } from '@sidhujag/sysweb3-core';
import { createKeyringHost } from '@sidhujag/sysweb3-keyring';

import type { DeviceUnlockPort } from '@sidhujag/sysweb3-keyring/cjs/keyring-core';

const VAULT = 'sysweb3-vault';
const KEYS = 'sysweb3-vault-keys';

export async function readBrowserDeviceUnlockVaultPair(
  storage: chrome.storage.StorageArea
) {
  const get = storage.get.bind(storage);
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
}

export function createBrowserKeyringHost(
  storage: chrome.storage.StorageArea,
  deviceUnlock: DeviceUnlockPort | null
) {
  const fixed = createFixedBrowserStateStorage(storage);
  return createKeyringHost(
    {
      ...fixed,
      readDeviceUnlockVaultPair: () =>
        readBrowserDeviceUnlockVaultPair(storage),
    },
    deviceUnlock === null ? {} : { deviceUnlock }
  );
}
