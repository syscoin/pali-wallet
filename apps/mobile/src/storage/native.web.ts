import { WalletStorageError } from './types.ts';
import type { OpenWalletStorage, StorageDigest } from './types.ts';
import type { StorageOpenObserver } from './openStages.ts';

/** Web never loads native SQLCipher, keychain or the private storage module. */
export function openNativeWalletStorage(
  _crypto: {
    randomBytes(length: number): Uint8Array;
    digest: StorageDigest;
  },
  _observeOpen?: StorageOpenObserver
): Promise<OpenWalletStorage> {
  return Promise.reject(new WalletStorageError('STORAGE_UNAVAILABLE'));
}
