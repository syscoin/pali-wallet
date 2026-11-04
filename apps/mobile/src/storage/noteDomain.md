# Read-only native note domain

This prerequisite does not expose note import, creation, backup files or a private
note UI. There is deliberately no production note writer. A future writer must be
admitted by the existing authenticated runtime and reviewed separately.

Schema 2 adds `private_note_records` to the existing SQLCipher database and owner
queue. An exact schema-1 database migrates by creating this empty table and
advancing `user_version`; existing keyring and metadata bytes are not rewritten.
Unexpected tables, schemas and versions refuse opening. Schema-1 readers refuse
schema 2. The generic keyring interface remains limited to 64 KiB per value and
64 records.

The new domain accepts at most one current-profile row, up to 16 MiB of encrypted
shared-vault JSON. Its profile ID and stable wallet binding are checked against
the current wallet identity. Those columns are not authentication: the existing
matching-phrase recovery must verify the HD root and the SDK private-record
profile, then authenticate every root/shard and validate every note using the
same reader as the extension. The shared inner AEAD binds domain, record ID and
mnemonic-derived profile; it does not bind an independent installation ID.
Unknown profiles, malformed rows, unsupported layouts and unavailable reads are
never empty inventories. A locked inventory can indicate retained note data but
cannot infer a decrypted note count or balance.

Recovery snapshots include the exact note bytes. A changed, added or removed row
invalidates the existing whole-state CAS. Recovery changes only the pair and
existing approved metadata; notes are never re-encrypted, pruned or silently
normalized. The original pair retirement, one-use proof, before-COMMIT guard,
close/reopen reconciliation and lost-acknowledgement quarantine remain required.
A matching phrase can decrypt retained note envelopes; it cannot regenerate
random bearer notes if those envelopes have been lost.

`source/wallet/privateVaultInspection.ts` is the shared authenticated reader.
`privateVaultEnvelope.ts` bounds and snapshots encrypted layout without keys;
`source/shared/jsonTextBudget.ts` bounds parsing before object allocation. The
extension controller delegates its old load path to that reader. Native recovery
has no provider or transaction capability and discards private read results.

The mobile manifest now declares `@noble/curves@1.9.7`, matching the extension's
canonical note parser, rather than relying on an undeclared transitive package.
Explicit `.ts` imports in mobile-reachable shared leaves work with Node's native
TypeScript loading; root TypeScript remains `noEmit` and permits those imports.

Host SQLite and SDK tests are not SQLCipher, device-memory, native-file or release
qualification. Native graph and bundle-size changes must be measured before the
future connected feature is enabled. No pool, funding, spending or seed-only
backup claim follows from this prerequisite.
