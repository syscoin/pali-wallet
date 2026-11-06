import * as SecureStore from 'expo-secure-store';
import { createPrivacyServiceSettings } from '../../../../source/shared/privacyServiceOrigin.ts';

const options = Object.freeze<SecureStore.SecureStoreOptions>({
  keychainService: 'org.pali.mobile.privacy-preferences',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
});

export const nativePrivacyServiceSettings = createPrivacyServiceSettings({
  async read(key) {
    if (!(await SecureStore.isAvailableAsync()))
      throw new Error('privacy_service_storage_unavailable');
    return (await SecureStore.getItemAsync(key, options)) ?? undefined;
  },
  async write(key, origin) {
    if (!(await SecureStore.isAvailableAsync()))
      throw new Error('privacy_service_storage_unavailable');
    await SecureStore.setItemAsync(key, origin, options);
  },
});
