# Fenced sustained wallet stress

`offline-sustained-wallet-stress.journey.spec.ts` exercises the real built Pali
extension in a fresh persistent Chromium profile. Its launch-time loopback deny
proxy never forwards HTTP or CONNECT. Exact Blockbook and read-only EVM fixtures
are fulfilled locally; no public-chain transaction is broadcast.

Every cycle edits a fee, selects native MAX, reviews, returns through Cancel or
Back, verifies the draft and quote, then confirms exactly once. The real wallet
signs linked synthetic P2WPKH transactions. The local receipt model independently
checks the current parent, self-recipient, bounded positive fee, SIGHASH_ALL and
ECDSA witness. This is not a Core or public-mempool acceptance test.
Compact history fixtures carry Blockbook's explicit account input/output totals;
Activity must show the exact native wallet fee loss for each sampled self-send,
without fetching full transactions to populate list rows.

Further phases create another account through normal UI, alternate account A/B
and same-ID UTXO/EVM vaults, inject one exact summary-read timeout, HTTP 429 and
offline failure, recover through ordinary reloads, stop/restart the MV3 worker,
then cold-close and reopen the same disposable browser profile. No controller
state or quote/signature response is replaced. The public synthetic seed must
never receive public-chain funds. Physical hardware is not used.

Modes are bounded and have no automatic retries or skips:

| `PALI_QA_STRESS_MODE` | Linked pending sends | Vault round trips |
| --------------------- | -------------------: | ----------------: |
| `quick`               |                    4 |                 2 |
| `standard` (default)  |                   24 |                 6 |
| `soak`                |                   64 |                 6 |

Run one exact journey, never the unfiltered live-testnet suite:

```sh
PALI_E2E_RUN_ID=offline-stress-unique \
PALI_QA_STRESS_MODE=standard \
PALI_TEST_DAPP_REVISION=<exact-built-40-character-commit> \
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/qualified/build/chrome \
yarn e2e:harness offline-sustained-wallet-stress.journey.spec.ts
```

Use `quick` for bounded PR conformance and `soak` for scheduled/manual runs.
Each run requires its own run ID, profile and fixture port. Parallel execution
with other explicitly fenced synthetic QA may use distinct profiles, ports and
run IDs; never share a live wallet or nonce domain. The source version must match
the exact extension version. The artifact report binds manifest/background hashes
and the test source, while launch separately verifies executing worker bytes.

The JSON report includes per-action timings and descriptive median/p95/max,
renderer heap/DOM/frame samples, request counts, unique receipts, injected faults
and storage-change counts/serialized byte lengths. Storage observations never
report vault contents and reset with the document. Heap samples include ordinary
garbage-collector variation; they do not establish absence of leaks, sustained
production throughput, a percentile SLA or a reliability probability. Videos,
step screenshots, ordinary test failures and zero-retry Playwright reports remain
available alongside the metrics. A run with failed assertions is not accepted by
the presence of a partial artifact.

Baseline and final-send samples include separately labelled forced-GC diagnostic
snapshots. Intermediate samples preserve natural GC behavior. Measurement and
storage-event observer overhead is included; these are not uninstrumented
production benchmarks.
