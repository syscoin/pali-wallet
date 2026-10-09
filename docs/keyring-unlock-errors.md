# Unlock error classification

Published `@sidhujag/sysweb3-keyring` 1.0.610 and 1.0.611 convert every exception in
`unlock()` into `canLogin: false`. Pali treats that result as an incorrect
password and consumes a failed attempt. Storage, key derivation and session
initialization failures can therefore make a correct password appear wrong
and eventually trigger the five-minute lockout. This is a confirmed mechanism
and a plausible explanation for the report; the historical incident was not
reproduced.

The source fix and real WebCrypto regressions belong upstream: [sidhujag/sysweb3#15](https://github.com/sidhujag/sysweb3/pull/15).
No local package patch is included in Pali. Pali 4.0.70 targets keyring 1.0.612. The package release will be published
separately; validation uses the upstream source build until that artifact is
available. The lockfile does not invent an integrity hash for an unpublished artifact. Local package validation
does not establish that the registry artifact has been published; clean CI installs remain blocked until publication.

The upstream contract required by Pali is:

- Failed first vault authentication returns `canLogin: false` and consumes one
  attempt, including for legacy CBC vaults.
- Storage, missing-vault, KDF, platform-crypto and post-authentication failures
  propagate without consuming password attempts.
- Partially initialized sessions are cleared after an operational failure.
- Authentication failures carry an internal error identity. An unrelated storage or KDF error with a matching public error code must not consume a password attempt.
- Interrupted legacy migration is retryable after the encrypted vault has been rewritten but before migration metadata is saved. GCM always uses the derived key; the raw legacy password is used only for legacy CBC data.
- Legacy double-encrypted secrets are validated before any replacement write. Empty or unrecoverable secrets preserve the original stored data. Secret-buffer cleanup does not depend on random-number generation succeeding.
- GCM authentication failure remains indistinguishable from damaged ciphertext
  and still counts as a failed attempt. Malformed envelope metadata is an
  operational storage-format error.
- Encryption algorithms, derivation settings and ciphertext formats stay unchanged.

Pali's controller regressions verify this contract using controlled keyring
results. Upstream regressions exercise the actual implementation with WebCrypto;
those tests are owned by the keyring repository. The dependency upgrade must
revalidate the contract against the released package.

The adversarial follow-up on upstream commit `15dd94f` passes 28 targeted cases and the full 19-suite, 300-test keyring suite. These are source-package results; npm publication is still a separate step.

A separate UI race is fixed in Pali: Home could read stale locked status after
successful unlock or wallet creation and redirect back to login. Unlock, seed import and new-wallet creation now await a fresh
authoritative status, and older replies cannot overwrite it. Failed confirmation after successful creation returns to existing-wallet recovery rather than creating the wallet again.

```sh
NODE_ENV=test yarn jest source/scripts/Background/controllers/MainController.security.spec.ts --runInBand --silent --coverage=false
```
