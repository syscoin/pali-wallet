import 'expo';
import { createNativeWalletCrypto, disposeWalletCrypto, qualifyWalletCrypto } from '../crypto/native';

let initialization: Promise<Crypto> | undefined;
let status: 'unchecked' | 'checking' | 'ready' | 'unavailable' = 'unchecked';

export function nativeCryptoStatus(): typeof status { return status; }

/** Every custody factory must await this before evaluating SDK modules. */
export function ensureNativeCryptoReady(): Promise<Crypto> {
  if (!initialization) {
    status = 'checking';
    initialization = Promise.resolve().then(async () => {
      let provider: Crypto | undefined;
      const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      try {
        // Node-style hashing/entropy and the wallet's WebCrypto have separate
        // adapters. Vault AES-GCM never uses QuickCrypto's untyped final error.
        // SDK loading must remain behind runtime qualification, including this
        // synchronous compatibility installation.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const quickCrypto = require('react-native-quick-crypto') as { install(): void };
        quickCrypto.install();
        provider = createNativeWalletCrypto();
        await qualifyWalletCrypto(provider);
        Object.defineProperty(globalThis, 'crypto', {
          value: provider, configurable: true, enumerable: true, writable: false,
        });
        if (globalThis.crypto !== provider) throw new Error('Crypto installation failed');
        status = 'ready';
        return provider;
      } catch {
        // Failure is terminal even if native cleanup or descriptor restoration
        // also fails. Never expose an adapter-specific error to the UI.
        status = 'unavailable';
        try {
          if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
          else Reflect.deleteProperty(globalThis, 'crypto');
        } catch { /* All custody entry points remain gated by the rejected promise. */ }
        try { if (provider) disposeWalletCrypto(provider); }
        catch { /* Disposal cannot turn a failed qualification into success. */ }
        throw new Error('NATIVE_CRYPTO_UNAVAILABLE');
      }
    });
  }
  return initialization;
}
