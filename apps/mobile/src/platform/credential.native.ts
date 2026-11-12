import * as SecureStore from 'expo-secure-store';
import { requireNativeModule } from 'expo-modules-core';
import { AppState, Platform } from 'react-native';
import { DeviceUnlockPrompt } from './deviceUnlockPrompt.ts';
import { createCredentialPort, createPublicViewAuthorizer, credentialPromptActivityState, type NativeCredentialModule, type NativeCredentialRequest, type NativeViewAuthorizationModule } from './credentialPort.ts';

const options: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.public-checkpoint.v1', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false };
const native = requireNativeModule<NativeCredentialModule & NativeViewAuthorizationModule>('PaliWalletStorage');
// Android's system credential Activity may pause our Activity. It is allowed only
// while the exact native request owns its OS prompt; no plaintext exists yet.
const promptState = (state: string) => credentialPromptActivityState(Platform.OS, state, native);
const prompt = new DeviceUnlockPrompt({
  state: () => promptState(AppState.currentState ?? 'unknown'),
  subscribe(listener) {
    const subscriptions = [AppState.addEventListener('change', state => listener(promptState(state)))];
    if (Platform.OS === 'android') {
      subscriptions.push(AppState.addEventListener('blur', () => listener('blur')));
      subscriptions.push(AppState.addEventListener('focus', () => listener('focus')));
    }
    return () => subscriptions.forEach(subscription => subscription.remove());
  },
});
let active: NativeCredentialRequest | null = null;
const setActive = (value: NativeCredentialRequest | null) => {
  if (value && active) throw new Error('CREDENTIAL_UNAVAILABLE');
  active = value;
};
export const authorizePublicView = createPublicViewAuthorizer({ native, prompt: (owner, work) => prompt.run(owner, work), setActive });
export const isNativeCredentialPromptActive = (owner?: AbortSignal) => promptState(AppState.currentState ?? 'unknown') !== 'background' && (owner ? prompt.isActive(owner) : prompt.isAnyPromptActive());
export const nativeCredentialAuthentication = Object.freeze({
  isActive: (owner: AbortSignal) => isNativeCredentialPromptActive(owner),
  isAnyPromptActive: () => isNativeCredentialPromptActive(),
  cancel() { prompt.cancel(); active?.cancel(); },
  run: prompt.run.bind(prompt),
});
export function createNativeCredentialPort() {
  return createCredentialPort({ native, prompt: (owner, work) => prompt.run(owner, work), setActive,
    publicStore: { get: name => SecureStore.getItemAsync(name, options), set: (name, value) => SecureStore.setItemAsync(name, value, options), remove: name => SecureStore.deleteItemAsync(name, options) } });
}
export async function getPublicViewAuthorizationStatus(): Promise<'ready' | 'missing' | 'unsupported'> {
  return (await createNativeCredentialPort().capabilities(null)).deviceAuth;
}
