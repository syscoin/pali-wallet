import type { CryptoBootstrapStep } from './diagnostics.ts';
import { requireNativeModule } from 'expo-modules-core';
import { createWalletCrypto } from './provider.ts';
import type { NativeCryptoModule } from './provider.ts';

export { disposeWalletCrypto } from './provider.ts';
export { qualifyWalletCrypto } from './qualification.ts';

/** Load only from native bootstrap, before constructing any SDK instance. */
export function createNativeWalletCrypto(onStep?: (step: CryptoBootstrapStep) => void): Crypto {
  try { onStep?.('native-module'); } catch { /* Diagnostic only. */ }
  return createWalletCrypto(requireNativeModule<NativeCryptoModule>('PaliWalletCrypto'), onStep);
}
