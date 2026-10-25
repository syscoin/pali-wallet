# Private note import

The Privacy page imports existing Tornado Classic ETH notes for the four pinned
Ethereum mainnet pools. It identifies each note locally, checks it against a
verified public pool snapshot, and saves admitted notes in the current wallet's
encrypted private vault. The page supports local status and balance display and
password-confirmed note backup. Deposits, withdrawals, proofs, and relayer
selection are not implemented in this stage.

Classic is not advertised as post-quantum privacy. Its public Pedersen
commitments and nullifiers permit additional candidate-linking attacks after
an elliptic-curve discrete-log break; this does not imply instant or unique
tracing of every historical withdrawal. Local AES-GCM note storage avoids the
optional ECC-encrypted onchain-backup mechanism but does not repair the public
protocol. See [L2BEAT's future-adversary assessment](https://l2beat.com/privacy/projects/tornado-cash#privacy).

`identifyClassicNote` requires the complete canonical note structure, the
supported denomination and network, and exactly 62 bytes of preimage. Surrounding
paste whitespace and hex letter case are accepted. It derives the commitment
from all 62 bytes and the nullifier hash from the first 31 bytes. Temporary byte
copies are cleared; JavaScript string/BigInt erasure cannot be guaranteed.

The implementation uses noble's generic Edwards arithmetic with the Classic
BabyJub parameters and three pinned public Pedersen generators. Twenty permanent
vectors cover signed windows and segment boundaries; 256 additional deterministic
synthetic preimages matched the original, unmodified `circomlibjs@0.1.7` reference.
That reference package is a development cross-check only and is not a dependency
of Pali. `@noble/curves@1.9.7` was already in the lockfile and is now explicit.

## Admission requirements

- Derive identity locally; never send the note, commitment or nullifier to an RPC
  or Sysnode as a lookup request.
- Use a snapshot actually hashed and anchored by the running controller. A
  persisted `ready` flag or cached frontier alone is insufficient after restart.
- Match the commitment against the verified deposit list. No match in incomplete
  or stale data means waiting for verification, not a definitive invalid note.
- Require the whole-pool withdrawal list and its block watermark. Old snapshots
  without this field are incomplete and must be synced again.
- Treat a matching nullifier as already withdrawn. Absence is only as current and
  complete as the bulk feed; the deposit root does not authenticate that absence.
- Serialize duplicate checks for the same chain, pool and commitment within the
  encrypted profile, together with durable writes. The same preimage can appear
  in different pools, whose nullifier sets are independent. Reject
  completion after a wallet session/profile change. All note metadata belongs
  inside the encrypted record, with random opaque record IDs outside it.

A spent note can be represented as history but contributes no available balance.
The UI must distinguish waiting, verified deposit, and withdrawal state at the
reported block. No balance view initiates a note-specific request.

## Custody and display

The keyring's private-record API encrypts the note manifest with a
profile-scoped AES-GCM key. Only ciphertext and an opaque profile storage key
are written to extension storage. Import checks and durable writes are
serialized, with wallet-session checks across asynchronous work. Forget-wallet
cleanup includes the private vault in the existing rollback journal.

Revealing a saved note uses the wallet's existing password throttling. The page
hides revealed notes on a wallet/context change, document hide, or unmount.
Browser strings cannot be guaranteed to be erased from process memory; the
application avoids keeping plaintext notes in persistent or shared UI state.
The wallet seed alone does not recreate randomly generated notes from another
wallet: users must retain their note backups.

The UI polls only local verified state for saved-note status. Public pool sync
is separately opt-in and runs at the shared 15-minute boundary. Pausing sync
preserves the last verified snapshot; clearing that public cache makes note
status wait for fresh verification without deleting encrypted private notes.
