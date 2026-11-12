import { WalletStorageError } from './types.ts';
import type { OpenWalletStorage, StorageDigest } from './types.ts';
import type { StorageOpenObserver } from './openStages.ts';

export async function canResetNativeWalletStorage(): Promise<boolean> { return false; }
export async function resetNativeWalletStorage(_authorization: {
  signal: AbortSignal; assertCurrent(): void; authorize(): Promise<void>;
}): Promise<void> { throw new WalletStorageError('STORAGE_UNAVAILABLE'); }

/** Web never loads native SQLCipher, keychain or the private storage module. */
export function openNativeWalletStorage(
  _crypto: {
    randomBytes(length: number): Uint8Array;
    digest: StorageDigest;
  },
  _observeOpen?: StorageOpenObserver,
  _expectedInstallationId?: string
): Promise<OpenWalletStorage> {
  return Promise.reject(new WalletStorageError('STORAGE_UNAVAILABLE'));
}
