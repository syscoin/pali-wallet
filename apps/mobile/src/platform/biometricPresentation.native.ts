import { Platform } from 'react-native';
import { detectBiometricPresentation, genericBiometrics, type BiometricPresentation } from '../core/biometricPresentation';

let detection: Promise<BiometricPresentation> | undefined;
/** Detection only. The protected SDK credential remains the sole authentication path. */
export function readBiometricPresentation(): Promise<BiometricPresentation> {
  return detection ??= (async () => {
    try {
      const reader = await import('expo-local-authentication');
      return await detectBiometricPresentation(Platform.OS, reader);
    } catch { return genericBiometrics; }
  })();
}
