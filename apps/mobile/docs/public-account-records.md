# Canonical public account records

Watch accounts use one version-1 document at `pali.mobile.public-accounts.v1`. A record is either an explicit address map or a UTXO public identifier. The identifier is a public account key or a descriptor supported by the existing SDK. Public snapshots expose only the name, id and derived receive address; account keys remain internal to the repository and its reader.

The extension's public-input validator rejects private material. Existing SDK descriptor and extended-key helpers validate and derive the receive address. Bare extended keys follow the same canonical conversion as the extension. Mobile does not parse or derive a separate address tree.

`records.load()` returns an immutable repository-issued snapshot. `records.compareAndSet(snapshot, records)` detaches and validates input before queueing, checks the entire current document, writes once and verifies exact durable readback. Snapshots are single-use and bound to the issuing repository and epoch. Failures after dispatch require reopening; uncertain writes cannot be silently overwritten. The queue serializes this process only; it is not a cross-process atomic lock.

Renaming preserves the public source; removal explicitly removes that record. The same manager edits address and account-key records so address projections cannot accidentally erase a public key. Unknown record kinds, extra fields, invalid documents and oversized input fail closed. There is no development-format migration or scanner checkpoint format.

Limits remain 20 accounts and 32 KiB per document. They reject the complete addition rather than truncating entries. Selection is stored separately as a bounded advisory hint and grants no signing authority.
