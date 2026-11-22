import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createSecurityRuntime } from '../core/securityRuntime';
import { SECURITY_PREFERENCES_KEY } from '../core/securityPreferences';
import { PublicViewLock, PUBLIC_VIEW_LOCK_KEY } from '../core/publicViewLock';
const SECURITY_READ_TIMEOUT_MS = 10_000;
const options: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.security-preferences', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false };
let memory: string | null = null;
let viewMemory: string | null = null;
const viewOptions: SecureStore.SecureStoreOptions = { ...options, keychainService: 'org.pali.mobile.public-view-lock' };

async function readSecureSetting(key: string, settings: SecureStore.SecureStoreOptions): Promise<string | null> {
  if (!await SecureStore.isAvailableAsync()) throw new Error('Security settings unavailable');
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A stalled read can be retried without releasing or duplicating a pending write.
  try {
    return await Promise.race([
      SecureStore.getItemAsync(key, settings),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Security settings read timed out')), SECURITY_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const publicViewLock = new PublicViewLock({
  async get() { return Platform.OS === 'web' ? viewMemory : readSecureSetting(PUBLIC_VIEW_LOCK_KEY, viewOptions); },
  async set(raw) { if (Platform.OS === 'web') { viewMemory = raw; return; } if (!await SecureStore.isAvailableAsync()) throw Error(); await SecureStore.setItemAsync(PUBLIC_VIEW_LOCK_KEY, raw, viewOptions); },
});
export const { securityPreferences, custodyIdle, watchIdle, beginIdleInteraction, captureIdleInteraction, recordIdleActivity } = createSecurityRuntime({
  async get() { return Platform.OS === 'web' ? memory : readSecureSetting(SECURITY_PREFERENCES_KEY, options); },
  async set(raw) { if (Platform.OS === 'web') { memory = raw; return; } if (!await SecureStore.isAvailableAsync()) throw Error(); await SecureStore.setItemAsync(SECURITY_PREFERENCES_KEY, raw, options); },
});
