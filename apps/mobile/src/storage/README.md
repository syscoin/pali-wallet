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
start at 30 seconds and rise to five minutes. Clock rollback cannot reduce them.
Operational errors must never be counted as wrong passwords.

Node tests exercise real SQLite transactions and SDK values. They do not establish
SQLCipher encryption, native keychain/file policy, power-loss durability or actual
iOS/Android behavior. Those require device qualification of the final binary.
