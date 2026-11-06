import type { CryptoBootstrapStep } from './diagnostics.ts';
export function createNativeWalletCrypto(_onStep?: (step: CryptoBootstrapStep) => void): Crypto {
  throw new Error('Native wallet cryptography is unavailable on web');
}

export function createNativePublicMerkleExecutor(): (
  program: Uint8Array, signal: AbortSignal, assertCurrent: () => void
) => Promise<Uint8Array> {
  throw new Error('Native public Merkle arithmetic is unavailable on web');
}

export { disposeWalletCrypto } from './provider.ts';
export { qualifyWalletCrypto } from './qualification.ts';
