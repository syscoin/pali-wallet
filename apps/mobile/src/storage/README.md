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
length before returning payload over the bridge. Initial limits are 64 KiB per
record, 256-byte keys, 16 records per atomic batch and 64 records total; larger
future data models need an explicit reviewed capacity change.

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

The internal `OpenWalletStorage.recovery` port reads one bounded, coherent snapshot
of all record and metadata rows. It does not mutate, migrate, decrypt or authorize
anything. `readIdentity` distinguishes a stable data binding from the current
encrypted-pair digest; legacy stores use that digest as their initial binding,
without an eager metadata write. Optional identity metadata must match the exact
current pair and still requires SDK root/profile authentication after unlock.
`getWalletFingerprint`, backup receipts and authentication retain their existing
encrypted-pair semantics.

`custody/recoveryInventory.ts` validates every known domain using its existing
parser and exposes only counts, categories and status. Unknown or invalid records
refuse eligibility and remain untouched. A successful inventory result means
`needs-matching-phrase-verification`, never safe, recovered or authorized. Password
reset, private decryption and atomic replacement are not implemented by this port.
