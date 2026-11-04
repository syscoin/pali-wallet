import type { CryptoBootstrapStep } from './diagnostics.ts';
export function createNativeWalletCrypto(_onStep?: (step: CryptoBootstrapStep) => void): Crypto {
  throw new Error('Native wallet cryptography is unavailable on web');
}

export { disposeWalletCrypto } from './provider.ts';
export { qualifyWalletCrypto } from './qualification.ts';
