import type { CryptoGlobalShape, CryptoInstallDiagnostic } from './diagnostics.ts';

function globalShape(target: object, key: string): CryptoGlobalShape {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) return Object.isExtensible(target) ? 'absent-extensible' : 'absent-fixed';
    const fixed = descriptor.configurable ? 'configurable' : 'fixed';
    if ('value' in descriptor) return `data-${descriptor.writable ? 'writable' : 'readonly'}-${fixed}`;
    return `accessor-${typeof descriptor.set === 'function' ? 'settable' : 'readonly'}-${fixed}`;
  } catch { return 'inspection-failed'; }
}

export function cryptoErrorKind(error: unknown): CryptoInstallDiagnostic['error'] {
  // Never read exception properties: even name/message getters can contain data.
  try {
    if (error instanceof TypeError) return 'type-error';
    if (error instanceof ReferenceError) return 'reference-error';
    if (error instanceof RangeError) return 'range-error';
    if (error instanceof SyntaxError) return 'syntax-error';
    if (error instanceof Error) return 'error';
  } catch { /* A hostile object can reject prototype inspection. */ }
  return 'other';
}

/** Invoke the pinned installer once with its original receiver; observe failure only. */
export function installQuickCrypto(
  module: unknown,
  onFailure: (diagnostic: CryptoInstallDiagnostic) => void,
  target: object = globalThis
): void {
  const globals = Object.freeze({
    buffer: globalShape(target, 'Buffer'), crypto: globalShape(target, 'crypto'),
    base64To: globalShape(target, 'base64ToArrayBuffer'), base64From: globalShape(target, 'base64FromArrayBuffer'),
  });
  let installer: CryptoInstallDiagnostic['installer'] = 'unreadable';
  try {
    const install = (module as { install: unknown }).install;
    installer = install === undefined ? 'missing' : typeof install === 'function' ? 'callable' : 'noncallable';
    Reflect.apply(install as () => void, module, []);
  } catch (error) {
    try { onFailure(Object.freeze({ installer, error: cryptoErrorKind(error), globals })); }
    catch { /* Diagnostic observers cannot replace the original failure. */ }
    throw error;
  }
}
