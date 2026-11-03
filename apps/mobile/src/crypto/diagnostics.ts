/** Public operation labels only. Never include native errors, keys or inputs. */
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
export type CryptoDiagnostic = Readonly<{ bootstrap: CryptoBootstrapStep; fullCase?: CryptoFullCase }>;
export function isCryptoDiagnostic(value: unknown): value is CryptoDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).every((key) => key === 'bootstrap' || key === 'fullCase') &&
    CRYPTO_BOOTSTRAP_STEPS.includes(data.bootstrap as CryptoBootstrapStep) &&
    (data.fullCase === undefined || CRYPTO_FULL_CASES.includes(data.fullCase as CryptoFullCase));
}
