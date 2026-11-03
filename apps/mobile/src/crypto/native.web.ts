export function createNativeWalletCrypto(): Crypto {
  throw new Error('Native wallet cryptography is unavailable on web');
}

export { disposeWalletCrypto } from './provider.ts';
export { qualifyWalletCrypto } from './qualification.ts';
