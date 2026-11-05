# Native encrypted note domain

This prerequisite adds a private exact replace operation to the existing encrypted
note domain. Connecting backup or restore still requires an authenticated native
runtime adapter and a separate file and UI flow.

The initial canonical SQLCipher schema creates `keyring_records`,
`wallet_metadata` and `private_note_records` in one transaction on a new, empty
database. The tables share one owner queue. Opening existing storage never
changes its schema. Unexpected or incomplete schemas and versions fail closed
without rewriting, deleting or resetting their contents. The generic keyring interface remains limited to 64 KiB per value and
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

The shared controller's optional serialized storage port supplies the exact raw
bundle it authenticated as the replace expectation. The native writer checks the
authenticated SDK profile and stable wallet binding against current metadata,
validates the bounded next bundle, and checks the caller's synchronous guard
before the transaction and at COMMIT dispatch. It requires exact readback before
acknowledging the write. An uncertain COMMIT or unverifiable readback quarantines
the connection. The restore token is consumed on its first attempt, so cold
reopen reads the encrypted receipt without replaying the write. The extension's
existing object storage uses its original save path.

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
