import { requireNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync } from 'expo-sqlite';

import {
  openWalletStorage,
  WALLET_DATABASE_NAME,
  WALLET_KEY_NAME,
  WALLET_KEY_SERVICE,
  canResetOrphanedWalletStorage,
  resetOrphanedWalletStorage,
} from './coordinator.ts';
import type { StoragePolicy } from './coordinator.ts';
import { requireSqlCipher } from './sqlCipher.ts';
import { WalletStorageError } from './types.ts';
import { observeStorageOpen } from './openStages.ts';
import type { StorageOpenObserver } from './openStages.ts';
import { observeNativeStoragePolicy } from './nativePolicyDiagnostic.ts';
import type {
  OpenWalletStorage,
  SqlConnection,
  StorageDigest,
} from './types.ts';

const keyOptions: SecureStore.SecureStoreOptions = {
  keychainService: WALLET_KEY_SERVICE,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
const orphanResetPorts = () => ({
  policy: requireNativeModule<StoragePolicy>('PaliWalletStorage'),
  keyStore: {
    get: () => SecureStore.getItemAsync(WALLET_KEY_NAME, keyOptions),
    remove: () => SecureStore.deleteItemAsync(WALLET_KEY_NAME, keyOptions),
  },
});

let orphanProbe: Promise<boolean> | null = null;
export function canResetNativeWalletStorage(): Promise<boolean> {
  // A remount joins the leased read instead of mistaking its busy lease for absence.
  if (!orphanProbe) {
    const pending = Promise.resolve().then(() => canResetOrphanedWalletStorage(orphanResetPorts()));
    orphanProbe = pending;
    void pending.finally(() => { if (orphanProbe === pending) orphanProbe = null; }).catch(() => undefined);
  }
  return orphanProbe;
}

/** Only the named, rechecked orphan database key is removed; no credential namespace purge. */
export function resetNativeWalletStorage(authorization: {
  signal: AbortSignal;
  assertCurrent(): void;
  authorize(): Promise<void>;
}): Promise<void> {
  return resetOrphanedWalletStorage(orphanResetPorts(), authorization);
}

/** Only call after qualified native crypto bootstrap; importing this does not open storage. */
export async function openNativeWalletStorage(
  crypto: {
    randomBytes(length: number): Uint8Array;
    digest: StorageDigest;
  },
  observeOpen?: StorageOpenObserver,
  expectedInstallationId?: string
): Promise<OpenWalletStorage> {
  observeStorageOpen(observeOpen, 'native-module');
  const nativePolicy = requireNativeModule<StoragePolicy>('PaliWalletStorage');
  const policy = observeNativeStoragePolicy(nativePolicy, observeOpen);
  return openWalletStorage({
    policy,
    ...crypto,
    observeOpen,
    keyStore: {
      get: () => SecureStore.getItemAsync(WALLET_KEY_NAME, keyOptions),
      set: (value) =>
        SecureStore.setItemAsync(WALLET_KEY_NAME, value, keyOptions),
    },
    openDatabase: async (directory, keyHex, token) => {
      observeStorageOpen(observeOpen, 'sqlite-open');
      const db = await openDatabaseAsync(
        WALLET_DATABASE_NAME,
        { useNewConnection: true, enableChangeListener: false },
        directory
      );
      try {
        await requireSqlCipher(db, keyHex, observeOpen);
        observeStorageOpen(observeOpen, 'policy-protect-database');
        await policy.protect(token);
        const protectedConnection: SqlConnection = {
          execAsync: async (sql) => {
            await db.execAsync(sql);
            if (sql === 'COMMIT') await policy.protect(token);
            // Rollback protection is cleanup of an earlier SQL failure.
            if (sql === 'ROLLBACK') await nativePolicy.protect(token);
          },
          runAsync: (sql, parameters = []) => db.runAsync(sql, [...parameters]),
          getFirstAsync: (sql, parameters = []) =>
            db.getFirstAsync(sql, [...parameters]),
          getAllAsync: (sql, parameters = []) =>
            db.getAllAsync(sql, [...parameters]),
          closeAsync: () => db.closeAsync(),
        };
        return protectedConnection;
      } catch {
        try {
          await db.closeAsync();
        } catch {
          throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');
        }
        throw new WalletStorageError('STORAGE_UNAVAILABLE');
      }
    },
  }, expectedInstallationId);
}
