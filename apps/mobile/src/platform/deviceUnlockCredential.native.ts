import * as SecureStore from 'expo-secure-store';
import { createDeviceUnlockCredentialStore } from '../storage/deviceUnlockCredential.ts';

// Keep this namespace separate from the database key and every unprotected item.
const protectedItem = Object.freeze<SecureStore.SecureStoreOptions>({
  keychainService: 'org.pali.mobile.device-unlock.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: 'Confirm biometrics for Pali',
});

export const nativeDeviceUnlockCredentialStore = createDeviceUnlockCredentialStore({
  async available() { return await SecureStore.isAvailableAsync() && SecureStore.canUseBiometricAuthentication(); },
  read: (name) => SecureStore.getItemAsync(name, protectedItem),
  write: (name, value) => SecureStore.setItemAsync(name, value, protectedItem),
  remove: (name) => SecureStore.deleteItemAsync(name, protectedItem),
});
