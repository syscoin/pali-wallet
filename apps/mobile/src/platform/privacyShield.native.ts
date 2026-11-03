import { Platform } from 'react-native';
import { enableAppSwitcherProtectionAsync, preventScreenCaptureAsync } from 'expo-screen-capture';

let protection: Promise<void> | undefined;

/** Once custody is opened, keep capture protection for the process lifetime. */
export function ensurePrivacyShield(): Promise<void> {
  if (!protection) protection = (async () => {
    try {
      await preventScreenCaptureAsync('pali-custody');
      if (Platform.OS === 'ios') await enableAppSwitcherProtectionAsync(1);
    } catch { throw new Error('PRIVACY_PROTECTION_UNAVAILABLE'); }
  })();
  return protection;
}
