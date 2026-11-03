import { requireNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync } from 'expo-sqlite';

import {
  openWalletStorage,
  WALLET_DATABASE_NAME,
  WALLET_KEY_NAME,
  WALLET_KEY_SERVICE,
} from './coordinator.ts';
import type { StoragePolicy } from './coordinator.ts';
import { requireSqlCipher } from './sqlCipher.ts';
import { WalletStorageError } from './types.ts';
import { observeStorageOpen } from './openStages.ts';
import type { StorageOpenObserver } from './openStages.ts';
import type {
  OpenWalletStorage,
  SqlConnection,
  StorageDigest,
} from './types.ts';

/** Only call after qualified native crypto bootstrap; importing this does not open storage. */
export async function openNativeWalletStorage(
  crypto: {
    randomBytes(length: number): Uint8Array;
    digest: StorageDigest;
  },
  observeOpen?: StorageOpenObserver
): Promise<OpenWalletStorage> {
  observeStorageOpen(observeOpen, 'native-module');
  const policy = requireNativeModule<StoragePolicy>('PaliWalletStorage');
  const keyOptions: SecureStore.SecureStoreOptions = {
    keychainService: WALLET_KEY_SERVICE,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  };
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
            if (sql === 'COMMIT' || sql === 'ROLLBACK')
              await policy.protect(token);
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
  });
}
