import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createFiatPreferences } from '../core/fiatPreference.ts';

const key = 'pali.mobile.display-currency';
const options: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.display', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const native = Platform.OS === 'ios' || Platform.OS === 'android';
let memory: string | null = null;
const preferences = createFiatPreferences({
  get: () => native ? SecureStore.getItemAsync(key, options) : Promise.resolve(memory),
  set: async (value) => { if (native) await SecureStore.setItemAsync(key, value, options); else memory = value; },
});
export const reloadFiatCurrency = preferences.reload;
export const saveFiatCurrency = preferences.save;
export function useFiatCurrency(enabled = true) {
  const value = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  useEffect(() => { if (enabled && preferences.getSnapshot().status === 'loading') void preferences.reload(); }, [enabled]);
  return value;
}
