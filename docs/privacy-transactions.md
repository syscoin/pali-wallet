# Private ETH notes and transactions

The Privacy screen uses the four pinned Tornado Classic ETH pools on Ethereum
mainnet. It is separate from ordinary wallet accounts: a note is a bearer secret,
and knowing the wallet recovery phrase is not sufficient to recover a randomly
generated note. Before deleting a wallet, moving to another installation or
starting recovery, use **Back up all private notes** to save an encrypted file
with a separate backup password. **Reveal for backup** remains available for an
individual note after wallet-password confirmation. Keep both backup forms secret;
a forgotten wallet password does not reveal the old encrypted vault. A restored
file preserves notes and history, then requires a local review before an ordinary
note can enter withdrawal. Imported raw notes require locally verified pool data;
an accepted spent note is labelled spent.

**Review restored note** uses your wallet password and the existing verified pool
snapshot, labelled with its block number. It does not perform a live chain check
or a note-specific RPC request. Verified deposit membership and an unspent
observation permit review for an ordinary note, including one with deposit-only
history. Missing, spent and unverified notes stay distinct. A withdrawal requires
its own new review and the normal proof and submission checks. Restoring a bearer
note does not cancel earlier withdrawals or invalidate other copies. Backups with
recorded unknown/submitted withdrawals require separate reconciliation and cannot
be released by this review action. Local review consent is never exported.

## Custody and transaction admission

New notes use 62 bytes of Web Crypto randomness. Their encrypted manifest is
durably saved before fee preparation or any submission can start. An expiring,
single-use review binds the current profile, account, network endpoint, pool,
amount, nonce and fees. A per-note encrypted reservation is written before the
sender is entered. Deposit and direct-withdrawal reservations also reject reuse
of the same sender nonce across both types of transaction.

As transaction journals grow, the vault can move from one encrypted record to
an atomic bundle of bounded encrypted chunks. Its encrypted index authenticates
their IDs, order, note counts and ciphertext hashes. The default limit is 128
saved notes (up to 4 MiB encoded); users may select 256 (8 MiB) or 512 (16 MiB).
Higher limits can use more local storage and slow vault operations. The SDK's
per-record limit remains unchanged, and admitted notes retain room for their
journals. Earlier prerelease single-record layouts are not accepted by this
reader; keep the original data and use its matching version to reveal/export
notes before moving them. The current bundle format is version 1, and older
wallet versions may not read its newer safety metadata. Changing the limit
does not remove notes. A lower limit is rejected if the existing notes do not
fit; the user must first reduce the saved count through an available safe action.

An explicit **Clear completed notes** action checks known withdrawal receipts
against the selected Ethereum RPC and removes a note only after its matching
withdrawal and any recorded deposit transaction are finalized. Notes with
unverified or unresolved journals remain saved. The RPC receives the known
withdrawal transaction hash and, when present, the related deposit transaction
hash, so the provider may link them. This check relies on that RPC's responses.
A note marked spent without a locally recorded submitted withdrawal and hash
cannot be cleared by this action. Checks and removals are performed one note at
a time; if interrupted, earlier removals may already be committed. Refresh the
list after an error before trying again.

For a locally recorded direct withdrawal that failed, **Recover failed withdrawal**
checks the original transaction and its proof before changing the saved hold.
Recovery requires a finalized reverted receipt, matching original calldata,
an unspent nullifier and an original proof root that the pinned pool no longer
accepts at that finalized block. A revert or an elapsed timeout alone never
releases a note. The RPC receives the transaction hash, proof root and public
nullifier; confirm this disclosure and your wallet password before checking.
The original journal and recovery evidence remain encrypted in the vault. A
new withdrawal requires a fresh review. Relayed and unknown attempts, and imported
withdrawal hints, remain blocked by this action. An exact local failed withdrawal
can be recovered while preserving its restored-note review guard; ordinary note
review can then proceed if no imported withdrawal uncertainty remains.

The initial sender integration supports HD and imported software accounts.
Hardware and smart accounts are rejected before note creation or RPC preflight:
the installed hardware sender can replace a supplied nonce, which does not satisfy
this feature's reviewed-nonce contract. Deposit and direct withdrawal require a
signing-capable account; an imported watch-only account can supply context for
relayed withdrawal, but cannot sign a deposit or direct withdrawal. Ordinary
wallet sending is unaffected.

An acknowledged transaction is not presented as a confirmed deposit or spent
note. Ambiguous transport outcomes retain the encrypted reservation and do not
offer automatic resubmission. A delayed acknowledgement cannot update another
profile after lock, account replacement or reset. Clearing a review never erases
its saved bearer note.

The withdrawal's original snapshot and review deadline are checked again at the
SDK's signing and broadcast boundaries, including after asynchronous preflight.
A received broadcast acknowledgement is retained even if the deadline expires
while the response is in flight.

## Local proof generation

Withdrawal preparation derives the note's commitment/nullifier locally and uses
a snapshot leased from the verifying background controller. Disk flags or UI
claims cannot create this lease. Clear, pause, refresh, replacement or expiration
revokes it. The Merkle path is checked against its root, and the current bulk
withdrawal set must not contain the note's nullifier. Preparation and submission
both check their original session and snapshot.

Public-pool verification also retains a small in-memory index of completed
upper subtrees. Even at the million-leaf limit it stores at most 8,191 roots.
Withdrawal preparation rebuilds only the selected block of up to 256 leaves,
then checks the resulting path against the anchored root. Refreshes copy the
index before extending it; a worker restart must reverify the public data before
it can serve paths. No note-specific request or trusted persisted path is added.

The packaged offscreen prover runs a static Classic witness interpreter and
Groth16 WASM in dedicated workers. No remote JavaScript, WASM or circuit wiring
is evaluated. The only downloaded artifact is the public proving key, whose
length and SHA-256 are pinned; cached copies are rehashed. The resulting proof
is independently verified against the packaged verification key and all six
public inputs before review. Cancellation terminates the workers. The generated
interpreter uses an explicit depth-first scheduler to avoid browser call-stack
overflow while preserving the original signal execution order.

The prover's upstream code and generated circuit functions have GPL-3.0-or-later
notices, retained in `source/scripts/privacyProver/COPYING` and `LICENSES.md` and
the built package. The surrounding repository's MIT notice does not replace
those terms. Corresponding source and reproducible generation instructions are
in that directory; distribution must respect the applicable component licenses.

## Direct and relayed withdrawal

Direct withdrawal uses the wallet account to pay gas. This publicly links that
gas payer to the withdrawal recipient. Its fixed 650,000 gas limit was tested
locally against all four deployed pool runtimes and their real verifier,
including the last slot of their 100-root history. The tested worst successful
EOA-recipient case used 576,906 gas. This is not a guarantee for arbitrary
recipient contract execution. Fee, nonce and gas-payer balance reads contain no
note-specific call. There is no withdrawal `eth_estimateGas`, `isSpent`, or
note-specific `eth_call`.

Relayer use is optional. Pali obtains a bulk public directory from the configured
Privacy service only when requested. That service defaults to `https://sysnode.info`
and is distinct from the selected Ethereum RPC and the chosen relayer endpoint.
The selected endpoint's status is checked again before proof construction and
submission. Pool support, reward account and fee parameters
must match the reviewed selection. The fee calculation uses exact integer
arithmetic; an advertised fee is not a promise that a relayer will accept a job.
Pali submits the reviewed proof once and never falls back to direct sending.

A returned job ID is an acknowledgement, not confirmation. Manual job checks
use the saved endpoint and verify the job's echoed pool, proof and six public
inputs against the encrypted journal before accepting a transaction hash.
Relayer status remains a claim; the locally verified public withdrawal feed
controls when the note is labelled spent.

## Public data and operational limits

Viewing note balances performs local calculations. Pool-wide sync and anchoring
are separate operations and do not include wallet addresses, notes or nullifiers
from the user's vault. The index service's withdrawal-feed completeness is a
trust assumption; Pali is not an Ethereum light client. Network endpoints can
still observe IP addresses, pool selection and request timing. This feature
does not claim post-quantum privacy or anonymity against all correlation.

Sysnode's index and relayer directory are disabled until their separate operator
flags are enabled with a suitable archive-capable Ethereum RPC. A deployed route
alone does not establish that indexing is active or caught up. See the backend's
`docs/privacy-index.md` and `docs/privacy-relayers.md` for configuration and
verification. No real-fund transaction or wallet/package release is part of the
development qualification.
