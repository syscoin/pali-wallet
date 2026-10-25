# Public privacy-pool preparation

This increment prepares public Tornado Classic ETH pool data. It does not create
notes, deposit, withdraw, generate withdrawal proofs, or claim that a wallet
address is private. The Privacy page states that scope. Only an explicit Prepare
action starts a job; opening the wallet or page does not contact the indexer.

## Data and verification

The anonymous Sysnode endpoint is
`https://sysnode.info/api/privacy/v1/pools/<public-pool-id>/snapshot`.
The four fixed Ethereum mainnet pool identities and deployment blocks come from
`tornadocash/tornado-cli@378ddf8b8b92a4924037d7b64a94dbfd5a7dd6e8/config.js`.
Requests contain no account address, private note, commitment, leaf position or
nullifier. Cookies and redirects are disabled. The serving operator can still
observe the requesting IP and pool; this is not a network-anonymity guarantee.

Pali bounds and validates the entire response, reconstructs the exact MiMC
Merkle root locally, and independently queries the selected Ethereum RPC.
Count, root, denomination and tree depth must match at the snapshot's block.
Block-number calls are fenced by matching hashes before and after the reads.
The current pool must still accept the root. The chosen RPC remains a chain
trust assumption; agreement with an indexer-provided root alone is insufficient.

The implementation uses no new runtime dependency. Hash and tree vectors were
cross-checked against unmodified circomlibjs 0.1.2 and fixed-merkle-tree 0.7.3.
The historical contract's empty-pool root is handled explicitly.

## Background work and storage

Public data lives in a separate `pali-public-privacy-pools` IndexedDB database.
It never enters the encrypted wallet, Redux balances, navigation state or dapp
permissions. A candidate is staged separately from the last verified snapshot.
Only a completed local hash calculation plus fresh chain checks publishes it.
Pause and Clear invalidate an in-flight generation atomically; late replies
cannot repopulate a cleared cache. Storage failures do not report success.

Hashing uses bounded batches and a 21-node frontier. Timers make progress while
the worker lives; a Chrome alarm resumes previously requested work after worker
suspension. No job can run while the browser is closed. Restart retains the
download but recomputes its root, because a stored frontier does not prove the
integrity of its consumed leaf prefix. In-memory verified prefixes can be reused
for append-only updates after comparing the old leaf sequence.

## Private-vault follow-through

The agreed transaction UX is a Private vault overview, initially Ethereum only,
with explicit Deposit and Withdraw actions. It is not an ordinary receiving
address or an implicit route for normal Send. Classic deposits use the supported
fixed denominations. Notes must be generated and durably encrypted before a
deposit can be submitted; pending/confirmed state follows real receipts.

Notes are bearer spending secrets. Their backup and reveal flow must require
reauthentication and remain separate from a normal account private-key field.
A seed-only backup must not claim to recover randomly generated notes unless
that recovery mechanism has actually been implemented and tested.

Withdrawal proofs must be generated locally by a separately packaged worker
compatible with the deployed Groth16 circuit and verifier. Executable code belongs
in the extension; larger public proving data needs pinned integrity checks.
Neither Sysnode nor a relayer may receive the note or witness.

Relaying is optional. Direct submission requires gas from the submitting account
and exposes that account's link to the withdrawal. Relayed submission discloses
its fee before approval. No automatic fallback may change that choice. Note
custody, proving and transaction submission require their own complete tests
before the preparation page becomes a spending surface.

## Checks

Feature suites cover canonical field/schema validation, wrong chain/pool,
independent RPC correlation, reorgs, expired roots, altered leaves, durable
publication, restart, cancellation/clear races, explicit opt-in and UI reply
ownership. Browser fixtures must be disposable and deny public broadcasts.

The Sysnode service must be enabled and its reverse-proxy route configured
before this client can prepare a live pool. Backend deployment settings are
documented in `sysnode-backend/docs/privacy-index.md`; a client build alone does
not deploy that service.
