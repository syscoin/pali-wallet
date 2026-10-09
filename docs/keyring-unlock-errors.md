# Unlock error classification

Published `@sidhujag/sysweb3-keyring` 1.0.610 and 1.0.611 convert every exception in
`unlock()` into `canLogin: false`. Pali treats that result as an incorrect
password and consumes a failed attempt. Storage, key derivation and session
initialization failures can therefore make a correct password appear wrong
and eventually trigger the five-minute lockout. This is a confirmed mechanism
and a plausible explanation for the report; the historical incident was not
reproduced.

The source fix and real WebCrypto regressions belong upstream: [sidhujag/sysweb3#15](https://github.com/sidhujag/sysweb3/pull/15).
Keyring 1.0.612 is now published. The subsequent migration/KDF fixes target
core 1.0.29 and keyring 1.0.613. No local package patch is included in Pali.
Validation against a local source package does not establish publication of
those newer artifacts; their release and a clean registry install remain
separate checks.

The upstream contract required by Pali is:

- Failed first vault authentication returns `canLogin: false` and consumes one
  attempt, including for legacy CBC vaults.
- Storage, missing-vault, KDF, platform-crypto and post-authentication failures
  propagate without consuming password attempts.
- Partially initialized sessions are cleared after an operational failure.
- Authentication failures carry an internal error identity. An unrelated storage or KDF error with a matching public error code must not consume a password attempt.
- Interrupted legacy migration is retryable after the encrypted vault has been rewritten but before migration metadata is saved. GCM always uses the derived key. Legacy CBC readers retain compatibility with prior password/derived-key formats; new writes require WebCrypto. The explicit historical profile described below preserves account-key access across capability changes.
- Legacy double-encrypted secrets are validated before any replacement write. Empty or unrecoverable secrets preserve the original stored data. Secret-buffer cleanup does not depend on random-number generation succeeding.
- GCM authentication failure remains indistinguishable from damaged ciphertext
  and still counts as a failed attempt. Malformed envelope metadata is an
  operational storage-format error.
- The initial 1.0.612 error-classification change preserved encryption algorithms,
  derivation settings and ciphertext formats. The 1.0.613 follow-up adds the
  explicit legacy KDF profile and write policy described below.

Pali's controller regressions verify this contract using controlled keyring
results. Upstream regressions exercise the actual implementation with WebCrypto;
those tests are owned by the keyring repository. The dependency upgrade must
revalidate the contract against the released package.

The historical upstream snapshot `5e253bf` passed 30 targeted authentication
cases, 13 transaction-submission boundary cases and the full 20-suite,
315-test keyring suite. Its interrupted-migration regressions covered both
WebCrypto and CBC fallback, rejected a wrong password without rewriting stored
records, and preserved operational decryption errors. Those counts describe
that source snapshot, not the later 1.0.613 implementation.

The 1.0.612 release also exposes `transactionNotBroadcast` on
formatted EVM transaction errors. A per-call flag records whether the provider's
broadcast method has been entered. Fee lookup, gas estimation and signing
failures before that boundary are safe to retry; failures after it remain
ambiguous. The marker must be derived from the current call, overriding a reused
error's old marker. Pali uses it to release only unsent infrastructure attempts;
an acknowledged transaction hash always takes precedence. This contract is
separate from password authentication and never changes failed-login counters.

## Persistence and KDF follow-up

The focused cryptography review found that core's storage adapter discarded
asynchronous write/removal failures. Core 1.0.29 returns the actual promises, so
keyring migration can await durable operations and retain recovery metadata
when one fails. Optional UTF-8 diagnostics consume their own write failures;
they cannot turn a successful secret operation into an unhandled rejection.

Keyring 1.0.613 requires WebCrypto for new AES-GCM writes. New wallets retain the
900,000-round PBKDF2-SHA512 profile. A legacy 20,000-round profile can be selected
only after successful authentication of compatible legacy data, and that choice
is persisted before rewriting the ciphertext. Unknown profile values fail
closed. A failed profile write leaves the old ciphertext untouched; a failed
rewrap leaves authenticated legacy data readable under its recorded profile.
When WebCrypto is available on a later unlock, an explicitly profiled legacy
CBC record can retry its GCM rewrap. Existing account-key wrapping is preserved
alongside the vault profile, preventing a successful vault unlock from losing
access to imported or derived account keys. This is compatibility work, not a
claim that all historical account keys have been rekeyed with stronger settings.

Fresh creation encrypts first and commits ciphertext with its salt in one native
storage batch. A rejected batch leaves neither record, and a committed pair
remains recoverable if its acknowledgement is lost. Native batch support is
required; sequential-only custom adapters fail before writing. Existing-vault
migrations retain their ordering. Pali rejects existing complete or incomplete
vault state before onboarding can reset it, and checks required WebCrypto
capability before beginning creation. Operational failures after authentication still clear partial
session state without consuming a wrong-password attempt.

Final [sysweb3#16](https://github.com/sidhujag/sysweb3/pull/16) validation uses production commit
`7eba1e9` and test-only follow-up `1f6b576`: 30 workspace suites / 432 tests pass, both
packages build, and all 127 packed files match the Pali installation. Pali
runtime `fa34432c` passes 148 suites / 1,400 tests, its production build and
creation/import/approval browser checks. Artifact hashes are recorded under
`cryptoFollowup` in [the evidence file](security-responsiveness-evidence.json).
Publication of core1.0.29/keyring1.0.613 and clean registry CI remain pending.

A separate UI race is fixed in Pali: Home could read stale locked status after
successful unlock or wallet creation and redirect back to login. Unlock, seed import and new-wallet creation now await a fresh
authoritative status, and older replies cannot overwrite it. Failed confirmation after successful creation returns to existing-wallet recovery rather than creating the wallet again.

```sh
NODE_ENV=test yarn jest source/scripts/Background/controllers/MainController.security.spec.ts --runInBand --silent --coverage=false
```
