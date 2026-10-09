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
available. The lockfile does not invent an integrity hash for an unpublished artifact. Successful normal login
smokes do not resolve the installed dependency's operational-error classification.

The upstream contract required by Pali is:

- Failed first vault authentication returns `canLogin: false` and consumes one
  attempt, including for legacy CBC vaults.
- Storage, missing-vault, KDF, platform-crypto and post-authentication failures
  propagate without consuming password attempts.
- Partially initialized sessions are cleared after an operational failure.
- GCM authentication failure remains indistinguishable from damaged ciphertext
  and still counts as a failed attempt. Malformed envelope metadata is an
  operational storage-format error.
- Encryption algorithms, derivation settings and ciphertext formats stay unchanged.

Pali's controller regressions verify this contract using controlled keyring
results. Upstream regressions exercise the actual implementation with WebCrypto;
those tests are owned by the keyring repository. The dependency upgrade must
revalidate the contract against the released package.

A separate UI race is fixed in Pali: Home could read stale locked status after
successful unlock and redirect back to login. Unlock now awaits a fresh
authoritative status, and older replies cannot overwrite it.

```sh
NODE_ENV=test yarn jest source/scripts/Background/controllers/MainController.security.spec.ts --runInBand --silent --coverage=false
```
