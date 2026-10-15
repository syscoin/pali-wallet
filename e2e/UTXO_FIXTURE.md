# Offline UTXO signing journey

This Playwright journey tests Pali's UTXO signing UI without connecting to
public chains or submitting transactions. It uses a public synthetic seed,
fabricated parent transactions, and controlled Blockbook responses. Those
parent outputs do not exist on-chain.

The optional loopback deny proxy is configured before Chromium starts its
extension worker. It never forwards HTTP or CONNECT requests. Once the context
exists, exact fixture reads are fulfilled; all other HTTP(S) requests abort.
REST `/sendtx` (GET and POST) and JSON-RPC send canaries check worker denial.
This is a browser HTTP(S) egress fence, not a claim about an OS-wide firewall.

The journey uses normal `sys_requestAccounts` and `sys_sign` approval UI. It
checks cancellation, unchanged transaction outputs/change, a real user witness,
and a mixed-owner PSBT whose sponsor input must stay unsigned. Only afterward
does the test's synthetic sponsor complete the other input; both witnesses are
independently verified. No signature response is replaced or injected.
The sponsor input belongs to account 1 of the same synthetic seed and carries
its valid fingerprint, public key and derivation path. An offline counterfactual
proves that the unscoped HD signer signs both accounts. The current keyring must
remove the out-of-account signing hints before signing, leave that input
unsigned, and preserve its public metadata for the later cosigner.
The shared browser response verifier compares the sponsor fingerprint, path and
public key byte-for-byte with the original PSBT before the synthetic cosigner
runs; missing or altered derivation metadata fails even when signatures remain
valid.

The existing `main.yml` conformance job selects this journey explicitly after
building the extension. Its `PALI_TEST_DAPP_EXTENSION_PATH` and revision inputs
also bind this test's artifact report. The fixture uses existing locked
dependencies, a dynamic loopback port, and the job's installed Chromium; no
wallet secrets, additional service or dependency installation is required.

Run only after the owner of any other browser QA has closed that session, with
an exact qualified extension directory and existing cached dependencies:

```sh
PALI_E2E_RUN_ID=offline-utxo-unique \
PALI_TEST_DAPP_REVISION=<exact-built-commit> \
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/qualified/build/chrome \
yarn e2e:harness utxo-psbt.journey.spec.ts
```

Do not use the default all-journeys command: other journeys can use public
testnets. Do not reuse a prior run ID/profile. This journey has no Anvil
dependency. Its offline fixture checks can run without a browser:

```sh
yarn jest --runInBand --coverage=false --runTestsByPath tests/unit/utxoFixture.test.ts
```

## Offline wallet lifecycle

`offline-wallet-lifecycle.journey.spec.ts` reuses the same public synthetic
seed, fabricated balance and launch-time deny proxy. It uses ordinary UI
controls to import the seed, Lock, reject a wrong password, reload the app
document while locked, and unlock the same account. The backup page must
reauthenticate before its phrase matches the fixture and clear it when the
password input changes. Only an in-page digest comparison is returned; the
phrase is not written to the result report, and textarea video/screenshots
remain masked.

The journey checks Cancel on the recovery warning, then performs real local
seed recovery with a new password **only in that fresh disposable profile**.
The restored UTXO receiving address must match the fixture; the old password
must fail and the new password must unlock it. No controller state is
injected, no signing is requested, and no transaction is broadcast. The PR
conformance job selects this journey explicitly.

```sh
PALI_E2E_RUN_ID=offline-wallet-lifecycle-unique \
PALI_TEST_DAPP_REVISION=<exact-built-commit> \
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/qualified/build/chrome \
yarn e2e:harness offline-wallet-lifecycle.journey.spec.ts
```

This establishes simulated normal-UI lifecycle behavior, not public-chain
balances, a cold browser-process restart, imported/watch-only account recovery,
hardware recovery, or cross-network vault isolation. The current fixture
serves only its primary UTXO account. Do not run the older shared-seed/public
network journeys as a substitute for these offline checks.

`yarn e2e:visual passwordSetup.spec.ts` separately checks compact mouse-wheel
scrolling, a renderer-only password-generation failure and nine translated
locales. Each uses an empty fresh profile behind the same deny proxy; none
submits Next or creates a wallet.
