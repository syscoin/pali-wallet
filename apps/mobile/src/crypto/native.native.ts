import type { CryptoBootstrapStep } from './diagnostics.ts';
import { requireNativeModule } from 'expo-modules-core';
import { createWalletCrypto } from './provider.ts';
import type { NativeCryptoModule } from './provider.ts';
import { createPublicMerkleExecutor } from './publicMerkleExecutor.ts';
import { createNativeSlhExecution, purgeNativeSlhPublicCache, type NativeSlhExecutionModule, type NativeSlhExecutionOptions } from './slhDsaNativeExecution.ts';

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

/** The shared signer owns every native context; only its public tree survives. */
export function createNativeSlhCapability(randomFill: (bytes: Uint8Array) => void) {
  const module = requireNativeModule<NativeSlhExecutionModule>('PaliWalletCrypto');
  return Object.freeze({
    open(owner: Pick<NativeSlhExecutionOptions, 'namespace' | 'signal' | 'assertCurrent'>) {
      return createNativeSlhExecution(module, {
        ...owner, randomFill, yield: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
      });
    },
    purgePublicCache: (namespace: string, assertCurrent: () => void) =>
      purgeNativeSlhPublicCache(module, namespace, assertCurrent),
  });
}
