import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createBalancePrivacy } from '../core/balancePrivacy.ts';
export { HIDDEN_BALANCE } from '../core/balancePrivacy.ts';

const key = 'pali.mobile.hide-balances';
const options: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.display', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const native = Platform.OS === 'ios' || Platform.OS === 'android';
let memory: string | null = null;
const preference = createBalancePrivacy({
  get: () => native ? SecureStore.getItemAsync(key, options) : Promise.resolve(memory),
  set: async value => { if (native) await SecureStore.setItemAsync(key, value, options); else memory = value; },
});
export const reloadBalancePrivacy = preference.reload;
export const saveBalancePrivacy = preference.save;
export function useBalancePrivacy() {
  const value = useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getSnapshot);
  useEffect(() => { if (preference.getSnapshot().status === 'loading') void preference.reload(); }, []);
  return value;
}
