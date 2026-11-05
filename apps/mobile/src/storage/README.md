# Native wallet storage boundary

This implementation is internal to the custody authority. It does not enable a
screen, signature or transaction by itself. `native.native.ts` requires a newly
built SQLCipher binary; it rejects plain SQLite. `native.web.ts` always rejects.

The native policy module leases one storage authority per process, uses iOS
Application Support with complete file protection and backup exclusion, and uses
Android `getNoBackupFilesDir`. The database, WAL, SHM and rollback journal share
that directory. It refuses symlinks, unknown files and exclusive-create conflicts.
Policy is checked on open and after commits. Android backup configuration and
iOS device behavior still require final-binary/device tests.

A random 32-byte database key and random installation identifier live in a
device-only SecureStore record. A known `provisioning` record can resume an empty
interrupted bootstrap using the same key. Once marked `ready`, a missing database
is an orphan-key error. A database without a key, different installation ID,
partial wallet pair, malformed metadata or unknown schema never becomes empty.
Nothing automatically deletes, resets or replaces those states.

Every SDK record operation runs on one private connection/queue. Writes use
`BEGIN IMMEDIATE` and wait for COMMIT. Ambiguous COMMIT or failed rollback poisons
the connection until it is closed and reopened. Reads admit SQLite type and byte
length before returning payload over the bridge. Ordinary keyring limits are 64 KiB per record, 256-byte keys, 16 records per
atomic batch and 64 records total. The single canonical account-map key has an
explicit 4 MiB byte limit with bounded JSON depth/work; this does not widen
mnemonic, authentication or other keyring values. Initial wallet installation
atomically commits its pair, authenticated identity/root and complete SDK account
map against one empty four-domain snapshot.

The separate `evm_signed_records` domain stores one opaque encrypted bundle for
the authenticated wallet profile, bounded by the common signed-record policy at
16 MiB and 4,096 transactions. It does not change the ordinary keyring limits.
The adapter compares exact previous bytes, acknowledges COMMIT and exact readback,
and retains uncertain writes for reopen. The common module owns bundle parsing, encryption, profile/chain/sender identity
and retention across typed account aliases. No admission, account removal or
public-history pruning evicts a retained predecessor; capacity refuses new
admission. SQLite owns physical atomicity and exact-byte acknowledgement.
`recovery.bindIdentity` first binds an SDK-authenticated root to the current pair
without changing the stable wallet binding, backup receipt or failure counter.

Backup confirmation hashes the exact stored wallet tuple with a domain-separated
SHA-256 digest. It compares the tuple again under the write transaction before
committing a receipt. Only the trusted authority's verified phrase challenge may
call it. Password backoff is durable: after five explicit SDK rejections, delays
start at 30 seconds and rise to five minutes. Admission uses the native monotonic
clock; changing system wall time cannot shorten the delay. Reopening a throttled
wallet starts its complete stored delay again because elapsed time while closed
is not trusted. The existing authenticated failure metadata format is retained.
Operational errors must never be counted as wrong passwords.

Node tests exercise real SQLite transactions and SDK values. They do not establish
SQLCipher encryption, native keychain/file policy, power-loss durability or actual
iOS/Android behavior. Those require device qualification of the final binary.

## Recovery inventory reads

The internal `OpenWalletStorage.recovery` read methods take one bounded, coherent snapshot
of all record, metadata, note and signed-bundle rows. It does not mutate, decrypt or authorize
anything. `readIdentity` distinguishes a stable data binding from the current
encrypted-pair digest; new wallets persist their authenticated root/profile with the initial pair and
full account map in the same transaction. Identity metadata must match the exact
current pair and still requires SDK profile authentication after unlock.
Signed-bundle bytes participate in the same exact snapshot comparison and are
preserved during recovery and rollback. Inventory counts retained signed records
through the common inspector; it does not infer their pending/terminal phases.
`getWalletFingerprint`, backup receipts and authentication retain their existing
encrypted-pair semantics.

`custody/recoveryInventory.ts` validates every known domain using its existing
parser and exposes only counts, categories and status. Unknown or invalid records
refuse eligibility and remain untouched. A successful inventory result means
`needs-matching-phrase-verification`, never safe, recovered or authorized. Password
reset or authentication is not implemented by these read methods.

The backend-only recovery coordinator verifies the matching phrase with the public
software SDK in an isolated staging host. Its opaque one-use proof can prepare an
atomic pair/account-map/identity/backup/auth replacement. Shared recovery
rewraps the complete SDK account records under the new password, preserving IDs,
metadata and typed aliases. Existing seed-profile imported recovery copies,
recognized note ciphertext, signed bundles and unrelated saved records retain
their exact bytes; missing required copies fail before pair replacement. The old authority and storage lease must drain first. Ambiguous commits
are closed and read back, never compensated by deleting data or replaying a reset.
The native runtime authenticates root/profile and current pair before using a stable
binding for account, token, Activity and signed-record data. Backup receipts still bind
the current encrypted pair. The native development recovery flow presents the
saved-data scope, verifies the matching phrase and returns to a fresh locked
owner. Native-device recovery qualification remains a separate release gate.

Retryable recovery failures retain the recovery-owned connection after locking
staging secrets. Every retry reads a fresh snapshot and checks the same pair and
authentication guard; its monotonic cooldown can therefore elapse without a
reopen restarting it. Cancellation, disposal, expiry and terminal errors close
that lease. Ordinary connection restarts still impose the complete persisted
delay; recovery never substitutes an editable wall clock or resets the counter.
