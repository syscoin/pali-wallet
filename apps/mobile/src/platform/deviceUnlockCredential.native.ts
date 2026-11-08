import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { createDeviceUnlockCredentialStore } from '../storage/deviceUnlockCredential.ts';
import { DeviceUnlockPrompt } from './deviceUnlockPrompt.ts';

// Keep this namespace separate from the database key and every unprotected item.
const protectedItem = Object.freeze<SecureStore.SecureStoreOptions>({
  keychainService: 'org.pali.mobile.device-unlock.v1',
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: 'Confirm biometrics for Pali',
});

export function createNativeDeviceUnlockCapability() {
  const prompt = new DeviceUnlockPrompt({
    state: () => AppState.currentState ?? 'unknown',
    subscribe(listener) {
      const subscription = AppState.addEventListener('change', listener);
      return () => subscription.remove();
    },
  });
  const credentials = createDeviceUnlockCredentialStore({
    async available() { return await SecureStore.isAvailableAsync() && SecureStore.canUseBiometricAuthentication(); },
    read: (name) => prompt.run(() => SecureStore.getItemAsync(name, protectedItem)),
    write: (name, value) => prompt.run(() => SecureStore.setItemAsync(name, value, protectedItem)),
    remove: (name) => SecureStore.deleteItemAsync(name, protectedItem),
  });
  return { credentials, prompt,
    randomId: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
  };
}
