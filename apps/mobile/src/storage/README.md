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

## Explicit wallet removal storage seam

`OpenWalletStorage.removal.commit` is a private host capability. A future
removal flow must obtain fresh authorization and final destructive confirmation,
retire the custody session, then submit a one-use recovery snapshot and a
synchronous guard for the exact owner. The snapshot establishes what may be
deleted. It does not establish authentication. The writer checks both the
snapshot bytes and its own write generation, including when intervening writes
restore identical bytes.

One `BEGIN IMMEDIATE` transaction clears all wallet-owned records, backup,
authentication and identity metadata, encrypted private notes and retained
signed outcomes. It preserves the installation row. The transaction enables
and verifies SQLite `secure_delete` for the deletion and verifies the empty
scope before COMMIT. Only acknowledged COMMIT and exact empty readback return
`wallet-records-removed`. The old writer rejects further operations. A lost
COMMIT or readback returns `reopen-required` and quarantines that writer. After
it closes, a new owner can inspect the complete snapshot. No automatic deletion
retry, rollback of a committed removal or automatic creation is performed.

The result is logical removal of SQLite records. The SQLCipher installation
key and database file are retained, and encrypted page remnants may remain in
WAL, filesystem snapshots or underlying storage. Public watch records and
device-level custody/watch idle preferences live in separate app stores. The
advisory native selection can also remain there. The future app flow must
clear its obsolete native selection without removing an independent watch
selection. Any requirement to retire the installation key or reset preferences
must be completed and verified separately before reporting a wider removal
result.

The private native removal backend uses the existing SDK password check and
durable wallet throttle. Its opaque ticket expires after 30 seconds and admits
one separate confirmation. Confirmation retires signing and drains pending
runtime work while retaining the original storage owner. It clears an advisory
native selection on the existing public-store queue before SQL dispatch. If SQL
later rejects, that hint may still be empty. Watch selection, saved watch rows
and idle preferences are outside the removal scope.

Once dispatched, the backend closes the original owner and checks the complete
scope from a fresh protected connection constrained to the same installation.
This reopen cannot provision a replacement. It verifies logical removal or,
after an uncertain acknowledgement, an exact unchanged wallet. The native
lifecycle permits an empty replacement only after verified removal and after
both owners have drained. The user interface and its explicit warning and
confirmation controls are separate work.

## Device unlock enrollment reference

The private storage owner records only a nonsecret enrollment ID bound to the
installation, wallet and exact encrypted vault pair. The enrollment port reads
the pair and reference together. Only the canonical, current reference can
identify a protected credential. Absent or malformed references leave password
unlock and matching-phrase recovery available.

The private exact wallet snapshot represents the schema-bounded reference bytes
in hex for removal and recovery reconciliation. This preserves malformed text
across SQLite bridges that truncate embedded NULs or replace invalid UTF-8.
Only the enrollment parser decodes canonical printable ASCII. Confirmed removal
and phrase recovery retire the reference in their existing transactions. Rollback
retains the original bytes.

The biometric host must stage credentials in protected storage before
activating a reference. After verified revocation, replacement, recovery or
removal, it must retire the superseded credential alias separately. An
uncertain SQLite result or an owner retired after COMMIT requires reopening
before deciding which alias may be retired. This storage layer neither activates
biometrics nor establishes physical erasure of a credential or encrypted database
remnants.
