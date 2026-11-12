import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createSecurityRuntime } from '../core/securityRuntime';
import { SECURITY_PREFERENCES_KEY } from '../core/securityPreferences';
import { PublicViewLock, PUBLIC_VIEW_LOCK_KEY } from '../core/publicViewLock';
const options: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.security-preferences', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false };
let memory: string | null = null;
let viewMemory: string | null = null;
const viewOptions: SecureStore.SecureStoreOptions = { ...options, keychainService: 'org.pali.mobile.public-view-lock' };
export const publicViewLock = new PublicViewLock({
  async get() { if (Platform.OS === 'web') return viewMemory; if (!await SecureStore.isAvailableAsync()) throw Error(); return SecureStore.getItemAsync(PUBLIC_VIEW_LOCK_KEY, viewOptions); },
  async set(raw) { if (Platform.OS === 'web') { viewMemory = raw; return; } if (!await SecureStore.isAvailableAsync()) throw Error(); await SecureStore.setItemAsync(PUBLIC_VIEW_LOCK_KEY, raw, viewOptions); },
});
export const { securityPreferences, custodyIdle, watchIdle, beginIdleInteraction, captureIdleInteraction, recordIdleActivity } = createSecurityRuntime({
  async get() { if (Platform.OS === 'web') return memory; if (!await SecureStore.isAvailableAsync()) throw Error(); return SecureStore.getItemAsync(SECURITY_PREFERENCES_KEY, options); },
  async set(raw) { if (Platform.OS === 'web') { memory = raw; return; } if (!await SecureStore.isAvailableAsync()) throw Error(); await SecureStore.setItemAsync(SECURITY_PREFERENCES_KEY, raw, options); },
});
