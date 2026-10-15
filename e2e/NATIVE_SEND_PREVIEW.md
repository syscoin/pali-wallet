# Offline native Send preview

`native-send-preview.journey.spec.ts` reuses the synthetic seed, fabricated
100,000-satoshi prevout and launch-time deny proxy from `UTXO_FIXTURE.md`.
It does not change wallet state through a controller, replace estimates, or
inject a PSBT. The ordinary UI reads the fixture balance and builds its own
unsigned transaction.

The journey edits the fee, opens Confirm, cancels, edits the fee again, then
uses Back. It checks the displayed confirmation fees and requires both exact
selected fees, recipient and amount to survive navigation rather than being
overwritten by the recommended fee. Confirm is observed but never clicked.
HTTP(S) traffic remains fixture-only, and every broadcast-attempt counter must
remain empty. This is simulated unsigned UI coverage, not signing, submission,
SPT, bridge, relay-policy, confirmation or finality evidence.

Run against an exact 4.0.91 build, with no other wallet browser test running:

```sh
PALI_E2E_RUN_ID=offline-native-preview-unique \
PALI_TEST_DAPP_REVISION=<exact-built-commit> \
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/qualified/build/chrome \
yarn e2e:harness native-send-preview.journey.spec.ts
```

Do not run all journeys. A new run ID/profile is required.
