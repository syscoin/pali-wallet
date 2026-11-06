import type { CryptoBootstrapStep } from './diagnostics.ts';
import { requireNativeModule } from 'expo-modules-core';
import { createWalletCrypto } from './provider.ts';
import type { NativeCryptoModule } from './provider.ts';
import { createPublicMerkleExecutor } from './publicMerkleExecutor.ts';

export { disposeWalletCrypto } from './provider.ts';
export { qualifyWalletCrypto } from './qualification.ts';

/** Load only from native bootstrap, before constructing any SDK instance. */
export function createNativeWalletCrypto(onStep?: (step: CryptoBootstrapStep) => void): Crypto {
  try { onStep?.('native-module'); } catch { /* Diagnostic only. */ }
  return createWalletCrypto(requireNativeModule<NativeCryptoModule>('PaliWalletCrypto'), onStep);
}

/** Public arithmetic uses the existing module and never opens a wallet context. */
export function createNativePublicMerkleExecutor() {
  const module = requireNativeModule<{
    publicMerkleBatch(program: Uint8Array): Promise<Uint8Array>;
  }>('PaliWalletCrypto');
  return createPublicMerkleExecutor(module);
}
