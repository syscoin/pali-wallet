import type { CryptoLoadDiagnostic } from './diagnostics.ts';
import { cryptoErrorKind } from './quickCryptoInstall.ts';

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;
export type MetroErrorUtils = {
  getGlobalHandler(): ErrorHandler;
  setGlobalHandler(handler: ErrorHandler): void;
};

function describeLoadFailure(error: unknown): CryptoLoadDiagnostic {
  let message = '';
  try {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
      if (descriptor && typeof descriptor.value === 'string') message = descriptor.value.slice(0, 4096);
    }
  } catch { /* Never invoke message/stack getters or expose the raw exception. */ }
  return Object.freeze({
    error: cryptoErrorKind(error),
    markers: Object.freeze({
      quickCrypto: message.includes('QuickCrypto') || message.includes('react-native-quick-crypto'),
      nitroModules: message.includes('NitroModules') || message.includes('nitro-modules') || message.includes('Nitro Modules'),
      nativeHybrid: message.includes('HybridObject') || message.includes('hybrid object'),
      quickBase64: message.includes('QuickBase64') || message.includes('quick-base64'),
      turboModule: message.includes('TurboModule'),
    }),
  });
}

/** Capture only this synchronous load; Metro must unwind before the first error is rethrown. */
export function loadQuickCrypto<T>(
  load: () => T,
  onFailure: (diagnostic: CryptoLoadDiagnostic) => void,
  errorUtils: MetroErrorUtils | undefined = (globalThis as unknown as { ErrorUtils?: MetroErrorUtils }).ErrorUtils
): T {
  let captured = false;
  let firstError: unknown;
  let scopeActive = false;
  let previous: ErrorHandler | undefined;
  const recordFirst = (error: unknown) => {
    if (!captured) { captured = true; firstError = error; }
  };
  const capture: ErrorHandler = (error, isFatal) => {
    if (scopeActive) recordFirst(error);
    else previous?.(error, isFatal);
  };
  let value: T | undefined;
  try {
    if (!errorUtils || typeof errorUtils.getGlobalHandler !== 'function' || typeof errorUtils.setGlobalHandler !== 'function')
      throw new Error('NATIVE_CRYPTO_LOAD_GUARD_UNAVAILABLE');
    previous = errorUtils.getGlobalHandler();
    if (typeof previous !== 'function') throw new Error('NATIVE_CRYPTO_LOAD_GUARD_UNAVAILABLE');
    try {
      scopeActive = true;
      errorUtils.setGlobalHandler(capture);
      try { value = load(); }
      catch (error) { recordFirst(error); }
    } finally {
      // If restoration fails, the installed observer must no longer suppress
      // unrelated errors: it delegates to the original handler outside scope.
      scopeActive = false;
      errorUtils.setGlobalHandler(previous);
    }
  } catch (error) { recordFirst(error); }
  if (captured) {
    try { onFailure(describeLoadFailure(firstError)); }
    catch { /* Observation cannot replace the original load failure. */ }
    throw firstError;
  }
  return value as T;
}
