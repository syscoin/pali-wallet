import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { validatePublicAccounts } from './core/watchOnlyAuthority.ts';
import type { PublicAccount } from './core/types.ts';
import { createBalanceReader, utf8ByteLength } from './platformRpc.ts';

const PUBLIC_ACCOUNTS_KEY = 'pali.mobile.public-accounts.v1';
const MAX_PUBLIC_CONFIG_BYTES = 32 * 1024;
const STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'org.pali.mobile.public-accounts',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

export const isNativePersistence =
  Platform.OS === 'ios' || Platform.OS === 'android';
export const balanceReader = createBalanceReader();

// The web review build is ephemeral. It never writes browser storage.
let memoryAccounts: readonly PublicAccount[] = Object.freeze([]);
let storageQueue: Promise<void> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function assertSize(value: string): void {
  if (
    value.length > MAX_PUBLIC_CONFIG_BYTES ||
    utf8ByteLength(value) > MAX_PUBLIC_CONFIG_BYTES
  ) {
    throw new Error('Public account configuration is too large');
  }
}

async function requireNativeStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync()))
    throw new Error(
      'Device storage is unavailable. Your saved accounts were not changed.'
    );
}

export function loadPublicAccounts(): Promise<readonly PublicAccount[]> {
  return serialized(async () => {
    if (!isNativePersistence) return memoryAccounts;
    await requireNativeStorage();
    // Only an explicit missing entry means empty. Read/parse/schema errors propagate.
    const raw = await SecureStore.getItemAsync(
      PUBLIC_ACCOUNTS_KEY,
      STORAGE_OPTIONS
    );
    if (raw === null) return Object.freeze([]);
    assertSize(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        'Saved public accounts could not be read. They were not overwritten.'
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Unsupported public account configuration');
    const record = parsed as Record<string, unknown>;
    if (
      record.version !== 1 ||
      Object.keys(record).some((key) => key !== 'version' && key !== 'accounts')
    ) {
      throw new Error('Unsupported public account configuration');
    }
    return validatePublicAccounts(record.accounts);
  });
}

/** Public watch addresses only. This is not a seed, key or encrypted-vault store. */
export function savePublicAccounts(
  accounts: readonly PublicAccount[]
): Promise<void> {
  const validated = validatePublicAccounts(accounts);
  const raw = JSON.stringify({ version: 1, accounts: validated });
  assertSize(raw);
  return serialized(async () => {
    if (!isNativePersistence) {
      memoryAccounts = validated;
      return;
    }
    await requireNativeStorage();
    await SecureStore.setItemAsync(PUBLIC_ACCOUNTS_KEY, raw, STORAGE_OPTIONS);
  });
}
