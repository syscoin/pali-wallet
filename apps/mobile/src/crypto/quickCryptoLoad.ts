import type { CryptoLoadDiagnostic } from './diagnostics.ts';
import { cryptoErrorKind } from './quickCryptoInstall.ts';

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;
export type MetroErrorUtils = {
  getGlobalHandler(): ErrorHandler;
  setGlobalHandler(handler: ErrorHandler): void;
};

const sampleError = new Error('');
const builtinErrorGetters = Object.freeze({
  message: Object.getOwnPropertyDescriptor(sampleError, 'message')?.get ?? Object.getOwnPropertyDescriptor(Error.prototype, 'message')?.get,
  stack: Object.getOwnPropertyDescriptor(sampleError, 'stack')?.get ?? Object.getOwnPropertyDescriptor(Error.prototype, 'stack')?.get,
});

function safeStackFormatting(error: object): boolean {
  let current: object | null = error;
  for (let depth = 0; current && depth < 8; depth++, current = Object.getPrototypeOf(current) as object | null) {
    for (const field of ['message', 'name']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field);
      if (descriptor && !('value' in descriptor) && descriptor.get !== builtinErrorGetters.message) return false;
    }
    if (current === Error.prototype) return true;
  }
  return false;
}

function errorText(error: unknown, field: 'message' | 'stack'): string | undefined {
  try {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      const descriptor = Object.getOwnPropertyDescriptor(error, field);
      if (descriptor && typeof descriptor.value === 'string') return descriptor.value.slice(0, field === 'stack' ? 16384 : 4096);
      // Engines may install a built-in lazy accessor on each Error instance.
      // Accept only the getter captured from a fresh built-in Error, and avoid
      // formatting a stack through custom name/message accessors.
      const getter = builtinErrorGetters[field];
      if (getter && error instanceof Error && (!descriptor || descriptor.get === getter) &&
          (field !== 'stack' || safeStackFormatting(error))) {
        const value: unknown = Reflect.apply(getter, error, []);
        if (typeof value === 'string') return value.slice(0, field === 'stack' ? 16384 : 4096);
      }
    }
  } catch { /* No arbitrary exception getters or raw text may escape. */ }
  return undefined;
}

function describeLoadFailure(error: unknown, stage: CryptoLoadDiagnostic['stage']): CryptoLoadDiagnostic {
  const messageValue = errorText(error, 'message');
  const stack = errorText(error, 'stack');
  const message = messageValue ?? '';
  const locations: CryptoLoadDiagnostic['locations'][number][] = [];
  for (const match of (stack ?? '').matchAll(/^[ \t]*at [^\r\n]*?\((address at )?(?:[^()\r\n]*\/)?(main\.jsbundle|index\.android\.bundle):([0-9]{1,9}):([0-9]{1,10})\)[ \t]*$/gm)) {
    const line = Number(match[3]);
    const column = Number(match[4]) - (match[1] ? 0 : 1);
    const location = Object.freeze({ bundle: match[2] === 'main.jsbundle' ? 'ios' as const : 'android' as const,
      kind: match[1] ? 'bytecode' as const : 'source' as const, line, column });
    if (line < 1 || line > 100000000 || column < 0 || column > 2147483647) continue;
    if (!locations.some((old) => old.bundle === location.bundle && old.kind === location.kind && old.line === line && old.column === column)) locations.push(location);
    if (locations.length === 8) break;
  }
  return Object.freeze({
    error: cryptoErrorKind(error),
    stage, messageReadable: messageValue !== undefined, stackReadable: stack !== undefined,
    locations: Object.freeze(locations),
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
  let stage: CryptoLoadDiagnostic['stage'] = 'guard-setup';
  let firstStage: CryptoLoadDiagnostic['stage'] = stage;
  let scopeActive = false;
  let previous: ErrorHandler | undefined;
  const recordFirst = (error: unknown) => {
    if (!captured) { captured = true; firstError = error; firstStage = stage; }
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
      stage = 'module-load';
      try { value = load(); }
      catch (error) { recordFirst(error); }
    } finally {
      // If restoration fails, the installed observer must no longer suppress
      // unrelated errors: it delegates to the original handler outside scope.
      scopeActive = false;
      stage = 'handler-restore';
      errorUtils.setGlobalHandler(previous);
    }
  } catch (error) { recordFirst(error); }
  if (captured) {
    try { onFailure(describeLoadFailure(firstError, firstStage)); }
    catch { /* Observation cannot replace the original load failure. */ }
    throw firstError;
  }
  return value as T;
}
