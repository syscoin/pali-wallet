# Private ETH notes and transactions

The Privacy screen uses the four pinned Tornado Classic ETH pools on Ethereum
mainnet. It is separate from ordinary wallet accounts: a note is a bearer secret,
and knowing the wallet recovery phrase is not sufficient to recover a randomly
generated note. Keep the password-gated note backup before deleting a wallet or
moving to another installation. Imported notes are accepted only after local
pool data establishes their commitment; an accepted spent note is labelled spent.

## Custody and transaction admission

New notes use 62 bytes of Web Crypto randomness. Their encrypted manifest is
durably saved before fee preparation or any submission can start. An expiring,
single-use review binds the current profile, account, network endpoint, pool,
amount, nonce and fees. A per-note encrypted reservation is written before the
sender is entered. Deposit and direct-withdrawal reservations also reject reuse
of the same sender nonce across both types of transaction.

The initial sender integration supports HD and imported software accounts.
Hardware and smart accounts are rejected before note creation or RPC preflight:
the installed hardware sender can replace a supplied nonce, which does not satisfy
this feature's reviewed-nonce contract. Ordinary wallet sending is unaffected.

An acknowledged transaction is not presented as a confirmed deposit or spent
note. Ambiguous transport outcomes retain the encrypted reservation and do not
offer automatic resubmission. A delayed acknowledgement cannot update another
profile after lock, account replacement or reset. Clearing a review never erases
its saved bearer note.

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

Relayer use is optional. Pali obtains a bulk public directory from Sysnode only
when requested. The selected endpoint's status is checked again before proof
construction and submission. Pool support, reward account and fee parameters
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
