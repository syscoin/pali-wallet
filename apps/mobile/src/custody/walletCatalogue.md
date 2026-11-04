# Native wallet catalogue and HD account contract

`native-wallet-catalogue-v1` is a bounded record in the existing SQLCipher
`keyring_records` table. Value version 2 adds the shared EVM registry and durable
network selection. Committed version 1 has an explicit authenticated CAS
migration; this is independent of external note-backup formats. Absence creates
a new catalogue only after authentication. Unknown or corrupt records fail
closed and are never replaced. See [network context](networkContext.md).

The record contains the encrypted-vault fingerprint, monotonic `nextIndex`,
retired indices, revision, active account/network references, exact bundled EVM
registrations and their hashes, and public address/public key/label for each live HD account.
Account IDs are `hd:60:<index>`. The public projection omits public keys and the
wallet fingerprint. Recovery words, private keys, encrypted private-key fields,
passwords, and sessions never enter the catalogue. The database remains private
because public address/device associations are privacy-sensitive.

Authentication derives account zero using the existing shared SDK and verifies
the fingerprint and public key/address. Every additional live record is checked
against the SDK's fixed Ethereum indexed HD derivation. A public key must have a
bounded compressed/uncompressed secp256k1 shape and compute the same address.
Only internal runtime records retain the SDK's password-encrypted xprv; the host
strips it before persistence or UI projection. Hydration installs these derived
runtime records and the committed selected index before any signing request.
There is no new signing implementation, arbitrary path or key import. Runtime
network selection is separate from the staged Ethereum-only transfer capability.

Creation, restoration and removal require fresh SDK password authentication;
selection and rename require the current unlocked session. Synchronous runtime
admission excludes authentication, signing and backup work before authority
revision changes. Missing targets, count/highwater limits and prohibited removal
reject before revocation, preserving the ready context. Failures after work
begins still lock or quarantine; the parent screen retains static typed feedback
when account UI unmounts. Each accepted mutation revokes old transfer reviews and backup
challenges. Every await is guarded before accepting its result; a reentrant lock
cannot publish ready. Account IDs, revision and captured wallet context—not labels
or stored addresses alone—control the operation. UI disabling is not admission.

New account indices increase monotonically. At most 20 accounts can be live and
indices 0–4095 are supported; exceeding either bound fails explicitly. Account
zero, the selected account and the last account cannot be removed. Removing an
account does not move funds and does not depend on its balance. It preserves the
index as a tombstone. The explicit Removed accounts action authenticates and
derives that same index again; creation never fills a gap. Removed entries are
paged in the UI without omitting any supported index.

Mutations compare the exact prior record and commit the new revision atomically,
then read it back. Competing/stale writers cannot overwrite a newer context.
Nonboolean, failed or revoked write acknowledgements quarantine the catalogue
until close and fresh runtime/storage reopen. SDK secrets retire synchronously;
quarantine is reported asynchronously so cleanup still closes the connection.
Reopening validates whichever complete state committed. An acknowledged false
CAS result requires a fresh reconciliation and cannot be treated as success.

Index zero permanently retains the original `native-evm-transfer-v1` journal key;
other indices use `native-evm-transfer-v1:hd:60:<index>`. Selection never moves or
retargets journal entries. Removal refuses signed, attempted, submitted, malformed
or foreign-scope entries. Within the same SQL transaction as removal, the journal
must still be absent or byte-equal to its validated terminal (confirmed, reverted
or nonce-consumed) snapshot. Only that terminal row is deleted. Thus removed
indices do not accumulate journal rows past the store's 64-record bound. Restore
recovers the original address, not pruned completed local transaction history.
The legacy global journal is never deleted by account removal. Pending and
unknown outcomes remain recoverable after switching back or restarting.

The fingerprint hashes encrypted SDK vault and vault-key records. Password,
recovery or other legitimate vault rewrites require an explicit reviewed atomic
catalogue rebinding protocol. Existing fingerprint mismatch is never migration.
Changing the configured default RPC endpoint likewise requires explicit
registration migration; code defaults cannot silently replace a saved endpoint.

This slice covers seed-derived Ethereum accounts. Imported keys, hardware,
UTXO, custom networks, physical-device behavior and release qualification remain
separate work toward full extension parity.
