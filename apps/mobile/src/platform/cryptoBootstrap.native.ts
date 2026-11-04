import 'expo';
import type { CryptoBootstrapStep, CryptoInstallDiagnostic, CryptoLoadDiagnostic } from '../crypto/diagnostics.ts';
import { installQuickCrypto } from '../crypto/quickCryptoInstall.ts';
import { loadQuickCrypto } from '../crypto/quickCryptoLoad.ts';
import { createNativeWalletCrypto, disposeWalletCrypto, qualifyWalletCrypto } from '../crypto/native';

let initialization: Promise<Crypto> | undefined;
let checkpoint: CryptoBootstrapStep = 'unchecked';
export function nativeCryptoCheckpoint(): CryptoBootstrapStep { return checkpoint; }
let installDiagnostic: CryptoInstallDiagnostic | undefined;
export function nativeCryptoInstallDiagnostic(): CryptoInstallDiagnostic | undefined { return installDiagnostic; }
let loadDiagnostic: CryptoLoadDiagnostic | undefined;
export function nativeCryptoLoadDiagnostic(): CryptoLoadDiagnostic | undefined { return loadDiagnostic; }

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
        // QuickCrypto supplies its own native scheduler. SDK loading must remain
        // behind runtime qualification; no browser-process shim is installed.
        checkpoint = 'quick-crypto-load';
        const quickCrypto: unknown = loadQuickCrypto(
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          () => require('react-native-quick-crypto'),
          (diagnostic) => { loadDiagnostic = diagnostic; }
        );
        checkpoint = 'quick-crypto-install';
        installQuickCrypto(quickCrypto, (diagnostic) => { installDiagnostic = diagnostic; });
        checkpoint = 'provider-create';
        provider = createNativeWalletCrypto((step) => { checkpoint = step; });
        await qualifyWalletCrypto(provider, (step) => { checkpoint = step; });
        checkpoint = 'provider-install';
        Object.defineProperty(globalThis, 'crypto', {
          value: provider, configurable: true, enumerable: true, writable: false,
        });
        if (globalThis.crypto !== provider) throw new Error('Crypto installation failed');
        checkpoint = 'ready';
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
