# Offline native Send preview

`native-send-preview.journey.spec.ts` reuses the synthetic seed, fabricated
10,000,000-satoshi prevout and launch-time deny proxy from `UTXO_FIXTURE.md`.
It does not change wallet state through a controller, replace estimates, or
inject a PSBT. The ordinary UI reads the fixture balance and builds its own
unsigned transaction.

The journey edits the fee, opens Confirm, cancels, edits the fee again, then
uses Back. It checks the displayed confirmation fees and requires both exact
selected fees, recipient and amount to survive navigation rather than being
overwritten by the recommended fee. Confirm is observed but never clicked.
HTTP(S) traffic remains fixture-only, and every broadcast-attempt counter must
remain empty. This is a simulated unsigned UI test; it never signs or submits
a transaction.

Read-only fixture phases then model pending native debits. A manually entered
0.09 amount must survive a normal app reopening, while explicit MAX must rebase
to the new available balance and deduct the quoted network fee on Confirm.
A 0.0001 TSYS/vbyte rate must stay blocked in Send; 0.00001 TSYS/vbyte must
show its warning while allowing unsigned review. These are fabricated balances
and UTXOs, not a live mempool or high-fee submission.

Run against a matching qualified build of this checkout, with no other wallet
browser test running. Its manifest version must match `package.json`:

```sh
PALI_E2E_RUN_ID=offline-native-preview-unique \
PALI_TEST_DAPP_REVISION=<exact-built-commit> \
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/qualified/build/chrome \
yarn e2e:harness native-send-preview.journey.spec.ts
```

Do not run all journeys. A new run ID/profile is required.
