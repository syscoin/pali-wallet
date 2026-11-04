import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createSecurityRuntime } from '../core/securityRuntime';
import { SECURITY_PREFERENCES_KEY } from '../core/securityPreferences';
const options: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.security-preferences', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false };
let memory: string | null = null;
export const { securityPreferences, custodyIdle, watchIdle, beginIdleInteraction, recordIdleActivity } = createSecurityRuntime({
  async get() { if (Platform.OS === 'web') return memory; if (!await SecureStore.isAvailableAsync()) throw Error(); return SecureStore.getItemAsync(SECURITY_PREFERENCES_KEY, options); },
  async set(raw) { if (Platform.OS === 'web') { memory = raw; return; } if (!await SecureStore.isAvailableAsync()) throw Error(); await SecureStore.setItemAsync(SECURITY_PREFERENCES_KEY, raw, options); },
});
