# Offline SPT Send preview

`spt-send-preview.journey.spec.ts` reuses the public synthetic seed and
launch-time deny proxy from `UTXO_FIXTURE.md`. Its controlled Blockbook fixture
provides one fabricated parent transaction carrying 100,000 native satoshis and
9,007,199,254,740,993 units of an eight-decimal SPT. The synthetic GUID is not
the reserved SYSX identity. No real chain or wallet balance is used.

The journey imports that token through the ordinary Assets UI. It verifies
that an amount one atomic unit below the balance remains exact through
Confirm/Cancel and Confirm/header Back, that genuine MAX remains exact, and
that insufficient native funds for the selected fee prevent preparation. It
then leaves the document and opens the normal neutral app entry to check the
persisted draft, using ordinary Unlock controls if needed. No controller state
is injected, no estimate is replaced, and Confirm is observed but never clicked.
Both the confirmation amount card and the existing Advanced Details view of
the prepared PSBT allocation must show the exact expected token amount.

Only exact fixture GET responses are fulfilled. Unknown HTTP(S), public
connections and broadcasts are denied; the write-attempt counter must stay
empty. The summary, screenshots and `spt-preview.json` retain build hashes and
explicitly identify the result as simulated UI evidence, not a live SPT send.

Run against a matching qualified build of this checkout, without another wallet
browser test running. The manifest version must match `package.json`:

```sh
PALI_E2E_RUN_ID=offline-spt-preview-unique \
PALI_TEST_DAPP_REVISION=<exact-built-commit> \
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/qualified/build/chrome \
yarn e2e:harness spt-send-preview.journey.spec.ts
```

Use a fresh run ID/profile. The PR conformance job selects this journey
explicitly; do not run the unrelated live-testnet journeys for this check.
