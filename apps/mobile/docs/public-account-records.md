# Internal public watch record repository

This is storage preparation only. Production still calls
`createPublicAccountStorage(port)` without a BIP84 adapter. No account-key import
route, scanner wiring, UI, notification or custody capability is enabled.

The optional second argument is a **trusted synchronous public SDK adapter**:

- `canonicalize({ networkId, accountKey }) -> { canonicalKey }` must validate a
  mainnet BIP84 public account through the published SDK and canonicalize aliases.
- `deriveFirstReceive({ networkId, canonicalKey }) -> { address }` must derive its
  fixed `/0/0` native-SegWit receiving address through that same public SDK entry.

No adapter or crypto parser is supplied here. Coarse host bounds/output shape
checks are not public-key validation, historical-path proof or ownership proof.
A future adapter must use the official published dependency, never a local SDK
copy, private method or caller-provided `validated` flag. Both methods are captured
at construction. Accessors, extra fields, asynchronous/thenable output and invalid
output shapes are rejected; callback errors do not expose their payloads.

With the adapter, the same repository exposes `records.load()`,
`records.compareAndSet(snapshot, nextRecords)` and
`records.saveCheckpoint(snapshot, id, checkpoint)`. These are internal APIs; their
snapshots contain stored public identifiers. Ordinary `PublicAccount` projections
contain only id/name/receiving-address maps and never keys or checkpoints.

The existing storage key `pali.mobile.public-accounts.v1` contains either its
unchanged version1 `{ version, accounts }` document or a version2
`{ version, records }` document. Version2 records discriminate `address` from
`bip84-public`. Address records retain explicit saved network mappings. BIP84
records contain id/name, fixed network, `bip84-p2wpkh` policy, canonical public
account key and a nullable advisory discovery checkpoint. Existing IDs cannot
change kind, address source, key, network or policy in a retained record. Renaming
and checkpoint updates preserve those fields. Canonical aliases deduplicate on
network plus key; BTC and SYS scopes remain separate.

Version1 loads never rewrite. An explicit record mutation is the only operation
that writes version2. Every version2 read validates every key and derives its
public projection through the adapter. Existing address-only APIs deliberately
refuse all version2 documents, even on an adapter-equipped repository, so a legacy
save cannot silently discard a key or checkpoint. The adapter-free production
repository therefore refuses future/unknown records while retaining their bytes.
Both versions retain the 20-account and 32KiB document limits. Invalid or unknown
data is not treated as a missing/empty store and is never truncated or repaired.

Record snapshots are frozen and bound to the issuing repository through internal
WeakMap state. They admit one write attempt; successful writes and ambiguous
attempts retire all older tokens. The repository detaches proposed input before
queueing, then validates it through the adapter while holding its existing serial
queue. It compares the **entire original raw document**, validates current data,
writes one document and checks both the readback bytes and decoded record data.
Record, legacy-account and selection operations use one queue. This is
same-process serialization plus read/compare/write/read-back, **not a cross-process
transactional CAS**; callers must retain one owner for the underlying store.

A rejected write can have reached storage. Such a failure leaves mutation
unavailable until an explicit successful load, never performs compensation and
never replays an old token after reopening. The same applies to failed readback.
Checkpoint updates compare the complete captured document, so a stale result
cannot recreate a removed account or overwrite a rename. Selection remains a
separate bounded advisory record and does not acquire signing authority.

Checkpoints use the existing strict BIP84 cursor: fixed network/source ID, two
bounded next/last-used index pairs, or null. No balance, complete bit, freshness
timestamp or address list is persisted. Cursor scope uses the immutable local
watch ID. Restoring it does not skip prefix validation or prove discovery; the
scanner still starts at zero after cold restart. No SQLCipher vault/recovery
record or keyring protocol is changed by this repository.

Tests use a deliberately synthetic injected port to validate host contracts, not
to claim SDK or native qualification. Official SDK adapter, real key vectors,
complete import/consent/portfolio/receive flow and native qualification remain
separate integration gates.
