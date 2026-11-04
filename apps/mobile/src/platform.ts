import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createPublicAccountStorage } from './core/publicAccountStorage.ts';
import { createBalanceReader } from './platformRpc.ts';
import { createUtxoBalanceReader } from './core/utxoBalanceReader.ts';
import type { BalanceReader } from './core/watchOnlyAuthority.ts';
import { walletFetch } from './platform/http';

const STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'org.pali.mobile.public-accounts',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
export const isNativePersistence = Platform.OS === 'ios' || Platform.OS === 'android';
const evmBalanceReader = createBalanceReader({ fetch: walletFetch });
const utxoBalanceReader = createUtxoBalanceReader({ fetch: walletFetch });
export const balanceReader: BalanceReader = Object.freeze({
  readBalance: evmBalanceReader.readBalance,
  readUtxoBalance: utxoBalanceReader.readBalance,
  readUtxoAccount: utxoBalanceReader.readAccount,
});
// The web review build is ephemeral. It never writes browser storage.
const memory = new Map<string, string>();
async function requireNativeStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) throw new Error('Device storage is unavailable. Your saved accounts were not changed.');
}
const publicStorage = createPublicAccountStorage({
  async get(key) {
    if (!isNativePersistence) return memory.get(key) ?? null;
    await requireNativeStorage();
    return SecureStore.getItemAsync(key, STORAGE_OPTIONS);
  },
  async set(key, value) {
    if (!isNativePersistence) { memory.set(key, value); return; }
    await requireNativeStorage();
    await SecureStore.setItemAsync(key, value, STORAGE_OPTIONS);
  },
});
export const loadPublicAccounts = publicStorage.loadAccounts;
export const publicAccountRecords = publicStorage.records;
export const loadAccountSelection = publicStorage.loadSelection;
export const saveAccountSelection = publicStorage.saveSelection;
