export type BiometricPresentation = Readonly<{ label: string; icon: string }>;
export const genericBiometrics: BiometricPresentation = Object.freeze({ label: 'biometrics', icon: 'fingerprint' });
const faceId: BiometricPresentation = Object.freeze({ label: 'Face ID', icon: 'face-id' });
const touchId: BiometricPresentation = Object.freeze({ label: 'Touch ID', icon: 'fingerprint' });
const fingerprint: BiometricPresentation = Object.freeze({ label: 'fingerprint', icon: 'fingerprint' });

/** Expo AuthenticationType values describe supported hardware, never successful authentication. */
export function describeBiometricHardware(platform: string, types: unknown): BiometricPresentation {
  if (!Array.isArray(types) || types.length === 0 || types.some(type => type !== 1 && type !== 2 && type !== 3)) return genericBiometrics;
  const unique = new Set(types);
  if (unique.size !== 1) return genericBiometrics;
  if (unique.has(1)) return platform === 'ios' ? touchId : platform === 'android' ? fingerprint : genericBiometrics;
  return platform === 'ios' && unique.has(2) ? faceId : genericBiometrics;
}

export async function detectBiometricPresentation(platform: string, reader: Readonly<{
  hasHardwareAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<unknown>;
}>): Promise<BiometricPresentation> {
  if (platform !== 'ios' && platform !== 'android') return genericBiometrics;
  try {
    if (await reader.hasHardwareAsync() !== true) return genericBiometrics;
    return describeBiometricHardware(platform, await reader.supportedAuthenticationTypesAsync());
  } catch { return genericBiometrics; }
}
