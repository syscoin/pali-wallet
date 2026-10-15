# Offline UTXO signing journey

This extends the existing Pali Playwright harness. It does not contact or test
the deployed bridge at bridge.tanenbaum.io and does not submit transactions.
The test uses a public synthetic seed, fabricated parent transactions, and
controlled Blockbook responses. Those parent outputs do not exist on-chain.

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
PALI_E2E_RUN_ID=offline-utxo-8153-new \
PALI_TEST_DAPP_REVISION=8153bbeeb68a8588ed0bdc81d17e73ef8ff4f02b \
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/qualified/build/chrome \
yarn e2e:harness utxo-psbt.journey.spec.ts
```

Do not use the default all-journeys command: other journeys can use public
testnets. Do not reuse a prior run ID/profile. This journey has no Anvil
dependency. Its offline fixture checks can run without a browser:

```sh
yarn jest --runInBand --coverage=false --runTestsByPath tests/unit/utxoFixture.test.ts
```

Remaining separate coverage: the actual bridge frontend/backend sponsorship
workflow, SPT transfers and native Send UI, mempool/confirmation/finality, and
physical hardware. Passing this journey must not be reported as those tests.
