import { AppState } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { createNativePasskeyClient, type NativePasskeyCapability, type NativePasskeyPort } from '../smartAccount/passkeys.ts';
import { createPasskeyPresentation } from './passkeyPresentation.ts';

// Same lifecycle rules as the existing protected-store OS prompt, but no vault secret.
const presentation = createPasskeyPresentation({
  state: () => AppState.currentState ?? 'unknown',
  subscribe(listener) {
    const change = AppState.addEventListener('change', listener);
    const blur = AppState.addEventListener('blur', () => listener('blur'));
    const focus = AppState.addEventListener('focus', () => listener('focus'));
    return () => { change.remove(); blur.remove(); focus.remove(); };
  },
});
export const isNativePasskeyPromptActive = presentation.isActive;
export function createNativePasskeyCapability(): NativePasskeyCapability | null {
  const port = requireOptionalNativeModule<NativePasskeyPort>('PaliPasskeys');
  if (!port) return null;
  try { port.getContext(); } catch { return null; }
  return createNativePasskeyClient({ port, randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
    present: (signal, request) => presentation.run(signal, request) });
}
