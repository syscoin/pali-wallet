/** Fixed public labels only. Never include raw errors, global values, keys or inputs. */
export const CRYPTO_BOOTSTRAP_STEPS = [
  "unchecked",
  "quick-crypto-load",
  "quick-crypto-install",
  "provider-create",
  "native-module",
  "provider-info",
  "provider-context",
  "self-test-sha256",
  "self-test-pbkdf2-import",
  "self-test-pbkdf2",
  "self-test-hkdf-import",
  "self-test-hkdf-bits",
  "self-test-hkdf-key",
  "self-test-aes-import",
  "self-test-aes-encrypt",
  "self-test-aes-decrypt",
  "self-test-aes-empty",
  "self-test-aes-rejection",
  "self-test-entropy",
  "self-test-key-metadata",
  "provider-install",
  "ready"
] as const;
export type CryptoBootstrapStep = typeof CRYPTO_BOOTSTRAP_STEPS[number];
export const CRYPTO_FULL_CASES = [
  "startup-known-answers",
  "startup-1-iteration:uint8-offset",
  "startup-1-iteration:data-view-offset",
  "startup-1-iteration:buffer-offset",
  "legacy-20000-unicode:uint8-offset",
  "legacy-20000-unicode:data-view-offset",
  "legacy-20000-unicode:buffer-offset",
  "current-900000-unicode:uint8-offset",
  "current-900000-unicode:data-view-offset",
  "current-900000-unicode:buffer-offset",
  "sdk-hkdf-key-import",
  "sdk-hkdf-profile",
  "sdk-hkdf-domain-key",
  "vault-v4-default-tag-no-aad:key-import",
  "vault-v4-default-tag-no-aad:known-answer",
  "vault-v4-default-tag-no-aad:reject-tag",
  "vault-v4-default-tag-no-aad:reject-ciphertext",
  "vault-v4-default-tag-no-aad:reject-iv",
  "vault-v4-default-tag-no-aad:reject-aad",
  "vault-v4-default-tag-no-aad:reject-key",
  "vault-v4-default-tag-no-aad:reject-invalid-arguments",
  "private-record-sdk-aad:key-import",
  "private-record-sdk-aad:known-answer",
  "private-record-sdk-aad:reject-tag",
  "private-record-sdk-aad:reject-ciphertext",
  "private-record-sdk-aad:reject-iv",
  "private-record-sdk-aad:reject-aad",
  "private-record-sdk-aad:reject-key",
  "private-record-sdk-aad:reject-invalid-arguments",
  "backup-pbkdf2-derived-key",
  "backup-eight-mib-boundary",
  "random-view-boundaries",
  "opaque-key-owner-and-disposal"
] as const;
export type CryptoFullCase = typeof CRYPTO_FULL_CASES[number];
export const CRYPTO_INSTALLER_KINDS = ['unreadable', 'missing', 'noncallable', 'callable'] as const;
export const CRYPTO_INSTALL_ERROR_KINDS = ['type-error', 'reference-error', 'range-error', 'syntax-error', 'error', 'other'] as const;
export const CRYPTO_GLOBAL_SHAPES = [
  'absent-extensible', 'absent-fixed',
  'data-writable-configurable', 'data-writable-fixed', 'data-readonly-configurable', 'data-readonly-fixed',
  'accessor-settable-configurable', 'accessor-settable-fixed', 'accessor-readonly-configurable', 'accessor-readonly-fixed',
  'inspection-failed',
] as const;
export type CryptoGlobalShape = typeof CRYPTO_GLOBAL_SHAPES[number];
export type CryptoInstallDiagnostic = Readonly<{
  installer: typeof CRYPTO_INSTALLER_KINDS[number];
  error: typeof CRYPTO_INSTALL_ERROR_KINDS[number];
  globals: Readonly<{ buffer: CryptoGlobalShape; crypto: CryptoGlobalShape; base64To: CryptoGlobalShape; base64From: CryptoGlobalShape }>;
}>;
export type CryptoLoadDiagnostic = Readonly<{
  error: CryptoInstallDiagnostic['error'];
  markers: Readonly<{ quickCrypto: boolean; nitroModules: boolean; nativeHybrid: boolean; quickBase64: boolean; turboModule: boolean }>;
}>;
export type CryptoDiagnostic = Readonly<{ bootstrap: CryptoBootstrapStep; fullCase?: CryptoFullCase; install?: CryptoInstallDiagnostic; load?: CryptoLoadDiagnostic }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCryptoInstallDiagnostic(value: unknown): value is CryptoInstallDiagnostic {
  if (!isRecord(value) || !isRecord(value.globals)) return false;
  const fields = ['buffer', 'crypto', 'base64To', 'base64From'];
  return Object.keys(value).length === 3 &&
    Object.keys(value).every((key) => ['installer', 'error', 'globals'].includes(key)) &&
    CRYPTO_INSTALLER_KINDS.includes(value.installer as CryptoInstallDiagnostic['installer']) &&
    CRYPTO_INSTALL_ERROR_KINDS.includes(value.error as CryptoInstallDiagnostic['error']) &&
    Object.keys(value.globals).length === fields.length &&
    fields.every((key) => CRYPTO_GLOBAL_SHAPES.includes((value.globals as Record<string, unknown>)[key] as CryptoGlobalShape));
}

function isCryptoLoadDiagnostic(value: unknown): value is CryptoLoadDiagnostic {
  if (!isRecord(value) || !isRecord(value.markers)) return false;
  const fields = ['quickCrypto', 'nitroModules', 'nativeHybrid', 'quickBase64', 'turboModule'];
  return Object.keys(value).length === 2 && Object.keys(value).every((key) => key === 'error' || key === 'markers') &&
    CRYPTO_INSTALL_ERROR_KINDS.includes(value.error as CryptoLoadDiagnostic['error']) &&
    Object.keys(value.markers).length === fields.length &&
    fields.every((key) => typeof (value.markers as Record<string, unknown>)[key] === 'boolean');
}

export function isCryptoDiagnostic(value: unknown): value is CryptoDiagnostic {
  if (!isRecord(value)) return false;
  return Object.keys(value).every((key) => key === 'bootstrap' || key === 'fullCase' || key === 'install' || key === 'load') &&
    CRYPTO_BOOTSTRAP_STEPS.includes(value.bootstrap as CryptoBootstrapStep) &&
    (value.fullCase === undefined || CRYPTO_FULL_CASES.includes(value.fullCase as CryptoFullCase)) &&
    (value.install === undefined || isCryptoInstallDiagnostic(value.install)) &&
    (value.load === undefined || isCryptoLoadDiagnostic(value.load));
}
