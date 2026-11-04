# Portable backup of the whole private-note vault

**Status: original design requirements. The shared codec/controller and extension file flows are now implemented; mobile private-note storage and file integration remain incomplete. This document is not validation evidence.**

Original source reviewed: Pali extension `4470e54e8777cca2a4fe7c712409f60eeb4fa401` (4.0.120). The enhancement described here was beyond that baseline. At the [current source basis](PARITY_MATRIX.md#current-implementation-ledger), `source/pages/Privacy/PrivateNoteBundleDialog.tsx` exposes extension export/import/verification; [the shared codec](../../../source/wallet/noteBackup.format.md) and [orchestration contract](../../../source/wallet/noteBackupService.md) define the implemented format and complete-current-profile scope. The original requirements below are retained as design history, not a claim that unrelated or unknown profiles are enumerated. Mobile integration still needs native storage, file, authentication and lifecycle adapters. Internal encrypted vault records are not a substitute for the portable file format.

## 1. What exists, and what this adds

At the original baseline, the extension backed up **one raw private note at a time**: choose the note, confirm the wallet password, view its read-only raw text, then Hide. That individual-note path remains available alongside the new bundle file flow. `PrivateNoteBackupDialog` has no app-provided Copy, Download or Share action; `PrivateNoteBundleDialog` owns the separate encrypted file flow. Individual raw-note import remains available through `privateVault.importNote`.

The private vault's encrypted root/shards and its 4/8/16 MiB storage budgets are **internal persistence**, bound to a local private-record profile. Copying those ciphertext records is not a portable backup. They are neither this proposed file format nor a promise that another wallet/device can decrypt them.

The enhancement adds one password-encrypted portable file containing the whole retained note inventory, with an import that validates and merges it atomically. It must work between the extension and mobile without the original device, OS keystore, wallet seed, or original private-record profile. Both hosts share one format implementation and vectors. Each host supplies native/browser file access, fresh wallet authentication, lifecycle and durable storage adapters.

This is a **private-note backup**, not a full wallet backup. It includes no wallet seed, imported-account private keys, hardware seed, passkey credential, smart-account validator secret, or general wallet settings. The UI must not label it “Back up wallet” or imply that it restores those items.

## 2. Scope and inventory

Default action: **Back up all private notes**. The export includes every retained note in the selected Pali wallet's private-vault inventory, across all supported pools, regardless of the currently visible pool filter or displayed spend status. This includes generated/prepared notes, funded notes, unresolved attempts and retained spent/completed notes. Automatically omitting spent-looking notes would trust a status cache and silently change the meaning of “all.”

Implementation must first establish how all current and legacy private-record profiles belonging to that wallet are enumerated and authenticated. If more than one profile exists, include each in the whole-vault inventory. Another independent wallet is not silently included. If a required profile is unavailable, corrupted, unsupported or not decryptable, do not produce a file labelled as a complete backup. Explain the blocked profile and leave the existing single-note recovery path available where it still works. Do not silently export only the currently unlocked account.

Before authorization, show an inventory such as:

- “All private notes in this wallet” and the exact number of retained notes/profiles.
- Counts grouped by supported network/pool, with “Prepared,” “Funded,” “Needs checking” and other statuses clearly marked as the local view.
- “Includes notes not yet funded and retained completed notes.”
- “Does not include your recovery phrase, account private keys or passkeys.”

A whole-vault snapshot is immutable for one export attempt. New notes created after that snapshot are not included. Capture the inventory and generation under the authority's persistence lock; abort/restart preparation if an operation changes it before the snapshot is sealed. Do not hold a storage lock while the user chooses a destination or types a password.

## 3. Portable contents and untrusted historical metadata

| Data                                                                                               | Export treatment                                                                                                        | Restore treatment                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical raw note                                                                                 | Required, inside authenticated ciphertext                                                                               | Parse and validate with the shared note implementation. Recompute all cryptographic identity fields.                                                                          |
| Protocol/note format                                                                               | Required, explicit version                                                                                              | Accept only supported versions; no heuristic fallback to another parser.                                                                                                      |
| Network/pool identity                                                                              | Chain identifier plus unambiguous network/pool identity, pool contract and denomination/schema                          | Compare against the supported registry. A display label is not identity. Reject mismatches before mutation.                                                                   |
| Commitment / derived identity                                                                      | Optional redundancy for integrity diagnostics; encrypted                                                                | Recompute from the raw note and compare; never trust the declared value. Deduplicate on the canonical protocol/network/pool/commitment identity.                              |
| Creation time and generated/imported origin                                                        | Bounded encrypted metadata                                                                                              | Preserve as historical metadata only. A timestamp or `generated` label does not prove deposit existence.                                                                      |
| Source profile association                                                                         | Optional opaque provenance/alias, encrypted                                                                             | Import into the authorized destination's encryption profile. Never require the old device's key, overwrite the destination seed, or grant permissions from an old profile ID. |
| Deposit/withdrawal evidence                                                                        | Minimal bounded historical hints: known transaction hashes, mode, timestamps and, where needed, job/attempt identifiers | Evidence for subsequent reconciliation only. Validate syntax, scope and bounds. Never resume a job or trust a supplied status because it was saved in the file.               |
| Local note IDs                                                                                     | Optional mapping/provenance                                                                                             | Allocate safe destination IDs for new notes. Do not use an imported UUID to overwrite an existing local record.                                                               |
| Proofs, active session tickets, authorization tokens, reusable signatures, raw signed transactions | Excluded                                                                                                                | No route can replay them from a backup.                                                                                                                                       |
| Cached balances, pool snapshots, “spent/unspent” flags, active reservations                        | Not authoritative; exclude caches or retain a minimal explicitly historical hint                                        | All imported notes begin with reconciliation required. Do not import “spendable,” “confirmed,” “not broadcast,” or an active reservation as authority.                        |

A restored unknown/submitted attempt must not become immediately withdrawable just because its old active reservation was omitted. Use a separate **Needs reconciliation** guard: it records the uncertainty without reactivating an old reservation or automatically restarting an external job. Verify the note/nullifier and relevant transaction evidence against current chain state before enabling withdrawal. Existing local reservations for duplicate notes always remain intact.

Keep necessary recovery information while minimizing metadata. Do not serialize the entire internal object graph, Redux state, request payloads, RPC credentials or local encrypted shards. The portable schema gets an explicit field allowlist and independently reviewed migration rules.

## 4. Password and cryptographic format requirements

Two different authorizations are involved:

1. **Fresh wallet authentication** permits the authority to read the selected local note inventory for this export. A cached unlocked UI or the backup-file password does not satisfy it.
2. **A separate portable backup password** encrypts this file. It is entered and confirmed for the file; never silently reuse/autofill the wallet password or derive it from an OS/device key. Explain that Pali cannot recover this password.

The backup key must depend only on the backup password and public, versioned KDF parameters in the file. A valid file and its password must restore on a new device into a different initialized Pali wallet. No seed, account address, original profile ID, native keystore or platform biometric material may be an indispensable decryption input.

### Candidate suite to review, not an approved specification

Use an established authenticated-encryption construction with a reviewed implementation shared by both hosts. A v1 candidate is **PBKDF2-HMAC-SHA-512 plus AES-256-GCM**, consistent with the cryptographic family already used by the keyring, with a unique CSPRNG salt per export and a fresh 96-bit GCM nonce per encryption under a derived key. Use a full authentication tag; never reuse the nonce/key pair. The production keyring's 900,000-iteration password profile is a comparison baseline, not permission to transplant desktop performance assumptions.

Before the format is frozen, cryptographic review must approve the exact suite, domain separation, salt/tag lengths, password encoding, KDF profile and hard bounds. Benchmark the lowest supported iOS/Android devices and extension browsers. If the approved cost cannot run acceptably, do not silently lower it, choose a fallback cipher, or save an unencrypted backup. A changed suite/cost is a new explicit reviewed profile.

Use a small, strictly parsed outer header containing only the magic, format version, allowlisted suite/KDF profile ID, salt, nonce and bounded ciphertext framing. Authenticate **all** those header fields as AEAD associated data, including lengths and version. The encrypted manifest contains note counts, pool identities, creation date, profile aliases and all recovery metadata. Do not expose note inventory, a plaintext secret hash or a standalone password verifier in the header. AEAD authentication failure must prevent any manifest use.

Password encoding must be identical across hosts: freeze one explicit Unicode-to-byte rule, no hidden trimming/case conversion, and reject invalid inputs rather than allowing platform-specific replacement behavior. Confirmation compares the same defined bytes. Set a documented maximum password length to bound processing; never truncate it.

A fresh export always uses new salt/nonce material even when inventory and password are unchanged. No encryption key, plaintext note buffer or backup password is retained in public state, log output, analytics, URLs or crash reports. Cleanup is best-effort in managed memory; do not claim provable JavaScript zeroization.

### Admission bounds

Publish finite, version-specific constants before implementation approval for:

- Total file bytes, plaintext bytes, notes, profiles and per-note metadata.
- Field/string/array sizes, parser depth/nodes and duplicate-key handling.
- Allowed KDF profiles and their exact work/memory cost; do not accept arbitrary header-supplied iteration or memory values.
- Simultaneous decrypt/export jobs and maximum operation duration.

Check the tiny header and file-size bound before invoking the KDF or allocating the claimed payload. Check plaintext and schema bounds after successful authentication, before any destination mutation. Use a reviewed parser with deterministic encoding and unambiguous duplicate-key handling. Version/profile negotiation never requests code or a parser from the network.

The format must carry the largest supported complete inventory within its published limits, including overhead. Internal 4/8/16 MiB budgets are not automatically portable file limits. If an inventory exceeds a tested bound, refuse this whole export with an actionable message; never truncate, silently split it or call a partial file complete. Increasing the limit is a measured, reviewed change.

**No compression or archive container in v1:** no ZIP, nested files, expansion bombs, archive paths or user-selected executable attachments. Encryption is not a reason to trust input sizes or metadata.

## 5. Export user flow

**Private notes -> Back up all private notes -> Inventory -> Authenticate -> Set backup password -> Preparing encrypted backup -> Save file -> Optional verify saved file.**

| Screen/state      | User-facing behavior                                                                                                                       | Authority/platform rule                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory         | Show exact scope and exclusions. Primary action “Continue.”                                                                                | Enumerate the whole supported inventory. No subset implied by active filters.                                                                     |
| Authenticate      | “Confirm your wallet password to back up these private notes.”                                                                             | Fresh purpose-bound auth. Invalidate it on lock, context change or expiry. No plaintext returned to React state.                                  |
| Backup password   | Password + confirmation; strength feedback; “Keep this password separately. Pali cannot recover it.”                                       | No silent reuse of wallet password or OS key. Inputs are transient and excluded from persistence/autofill.                                        |
| Preparing         | Progress, Cancel, and truthful message that no file has been saved                                                                         | Freeze one inventory; derive/encrypt in the isolated authority/worker. A cancelled or stale result cannot open a file picker.                     |
| Save              | Default neutral filename such as `pali-private-notes-2026-11-02.palibak`; user chooses destination                                         | Only encrypted bytes cross into the file adapter. No plaintext temporary file. Native protection/cleanup applies to app-owned staging ciphertext. |
| Save acknowledged | “Encrypted backup handed to your chosen destination.” Show snapshot time and note count. Offer “Verify saved backup.”                      | Browser download/OS share acknowledgement is not proof of durable storage, iCloud availability or recoverability.                                 |
| Verify file       | Select the saved file and re-enter the backup password; authenticate, parse and compare the expected encrypted snapshot's inventory digest | Read-only dry run. No notes are imported and no permissions/transactions are created.                                                             |
| Verified          | “This file was opened and its note inventory matched this backup.”                                                                         | Records a verified snapshot, not a promise that the destination will keep the file or the password will be remembered.                            |

Use exact outcome distinctions: **Cancelled**, **Preparation failed**, **Save could not be confirmed**, **File verified**. Never show “Backup complete” from a share sheet dismiss event. The user can leave after Save acknowledged, but reminders must not claim verification that did not happen.

A saved snapshot can become stale when notes are added or materially changed. Track coverage locally inside encrypted state and show “Notes added since your last verified backup.” Do not put a list of private commitments into public preferences merely to display this reminder.

Backgrounding cancels plaintext preparation/verification, clears transient password/secret access and invalidates the auth grant. If the OS file sheet is already operating on completed ciphertext, it may finish independently; record only the adapter's truthful outcome on resume. Process death cannot be repaired by persisting the password. Remove app-owned staging ciphertext at completion/cancel and on the next startup; the user controls external saved copies.

## 6. Restore user flow and atomic merge

**Private notes -> Restore note backup -> Select file -> Enter backup password -> Authenticate/decrypt/validate -> Review merge -> Fresh destination wallet authentication -> Atomic import -> Reconcile current chain.**

The destination must have an initialized private-vault encryption profile. On a new installation, complete separate wallet setup first; the file does not create a wallet seed. The original seed is not required to recover these bearer notes. Restore is available offline for local decryption and retention, but it does not label notes spendable offline.

1. **Read and admit.** Bound file size and parse only the minimal header. Reject unknown versions, suites and KDF profiles before expensive work. Do not auto-fetch schema updates. Reject unsupported pools/record types as an incompatible whole backup rather than silently dropping records.
2. **Authenticate and decrypt.** Use the file password, verify AEAD over ciphertext and header, then validate the entire plaintext/schema. Wrong password or corruption reports a neutral “Could not open this backup. Check the password and file.” No record or metadata preview is shown before authentication succeeds.
3. **Validate all notes.** Parse each raw note with the shared implementation; recompute identity, enforce pool/denomination consistency, reject malformed or duplicate-conflicting entries, and check the entire inventory and metadata bounds. No incremental import while parsing. A failing final record leaves the destination unchanged.
4. **Compare a frozen destination snapshot.** Show counts for new notes, exact duplicates and conflicts. “Already present” is not an error. A raw-note/identity or protocol conflict blocks the whole merge; do not choose a secret by timestamp. For harmless conflicting local labels/creation times, keep local metadata and explicitly show that imported metadata will not replace it. Preserve all existing local note status guards, reservations and history.
5. **Capacity check.** Compute the union of existing and new note identities across relevant profiles. If it exceeds the destination's supported capacity/budget, block the import and offer the supported capacity-change workflow where available. Do not evict spent notes, lower safeguards, truncate or import a subset without saying so. V1 performs one whole atomic merge or none.
6. **Fresh destination authorization.** “Import N new notes; keep M already present.” Requires current destination wallet authentication, bound to file digest, validated inventory, destination profile/generation and preview snapshot. The backup password alone does not authorize a merge into an already open wallet. No confirmation is inherited from the source wallet.
7. **Atomic commit.** Recheck the destination under the authority's persistence lock. If it changed, recompute the merge preview before mutation. Re-encrypt new records under the destination's current local vault key and commit the whole accepted union once. Readers cannot observe a half-imported manifest/shard set. No network request is part of this transaction.
8. **Reconcile after retention.** Mark all new notes `Needs reconciliation`; saved spent/funded/unknown labels are historical. Fetch only the same verified pool-wide public data used by the privacy subsystem, with the usual endpoint/session checks. Do not upload the decrypted bundle or a list of raw notes to any service. Validate current chain evidence before enabling note operations.

**Merge-only is the default and the v1 feature.** Restore never replaces the destination vault, deletes existing notes, switches a seed, or reduces capacity. A future replace action is a distinct destructive design, not an import checkbox.

No imported backup may reactivate a reservation, authorize a spend, resume a relay job, or mark a withdrawal “not broadcast.” Historical pending/unknown evidence keeps a note blocked until reconciliation resolves it. For exact duplicates, existing local active reservations and stronger uncertainty guards win. Chain confirmation and adequate finality policy are authoritative; a saved “unspent” flag is not.

Offline result copy: “N notes restored locally. Connect to verify their current status before withdrawing.” Unavailable, syncing, not found, funded, spent and unresolved submission remain distinct. An unconfirmed deposit is not discarded because it is currently absent from a snapshot.

## 7. Failure, cancellation and process death

| Boundary                                                                | Required outcome                                                                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Export before encrypted bytes are ready                                 | Cancel and clear transient secrets; no save result. Existing vault unchanged.                                                                  |
| Export file picker/share cancelled                                      | Do not record a verified or durably saved backup. Existing vault unchanged.                                                                    |
| Export verification interrupted                                         | No verification mark; next attempt asks for the password again.                                                                                |
| Restore before merge commit                                             | Cancel and discard staging plaintext; destination is unchanged.                                                                                |
| Restore transaction interrupted before durable commit marker            | Roll back or recover the prior complete state before normal vault access.                                                                      |
| Commit succeeds but acknowledgement is lost                             | On restart/readback, recognize the committed import receipt and complete cleanup; do not append the notes again or delete the committed state. |
| Process killed after commit but before chain reconciliation             | Keep restored records encrypted and marked Needs reconciliation. Resume public verification, not an old signing job.                           |
| Authentication cancelled, locked, or source/destination profile changes | Revoke the operation grant. A late worker/file result cannot reveal data, mutate another profile or navigate into success.                     |
| Cleanup fails                                                           | Preserve whichever complete committed state is authoritative; show recovery/retry state. Do not show an empty or partially imported vault.     |

For the extension, Chrome storage batches alone are not a transactional database. The shared import protocol needs an explicit journal/copy-on-write commit marker and a single authority/mutex that protects all readers. For mobile, the native database must supply equivalent atomicity and crash durability. Prove both through fault injection rather than assuming identical API names imply identical guarantees.

Persist an import receipt and minimal encrypted journal needed to distinguish committed/uncommitted outcomes. It may contain file/inventory digests and operation IDs, not the backup password or plaintext notes outside the protected vault. Any rollback snapshot has the same security/retention treatment as the vault. Preserve the encrypted source file on user-owned storage; do not modify it during restore.

## 8. Negative and cross-host acceptance tests

The release must pass these with synthetic notes on each supported host before real funds are used:

- Export with no notes, every supported pool, mixed prepared/funded/spent/unknown records, all profile groups, the canonical internal note format (and any explicitly supported future versions), and maximum supported inventory. Counts match the frozen inventory; no filtered-out note disappears.
- Locked/corrupt/unavailable profile during inventory; a whole export fails explicitly instead of silently excluding it. Concurrent note creation/change forces a new snapshot/coverage result.
- Fresh authorization rejection, password mismatch, weak/oversized password and Unicode edge cases. No fallback to wallet/device key or plaintext output; no secrets appear in UI snapshots, logs or errors.
- Identical exports yield different salt/nonce/ciphertext. Cross-host vectors prove exact password bytes, header authentication, KDF profile, encoding and tag handling.
- Wrong password; modified/truncated/reordered header, ciphertext or tag; changed lengths/suite/version; unknown or excessive KDF profile; duplicate keys; excessive nesting/counts/strings; integer overflow; invalid note; pool/denomination mismatch. All fail before any destination write.
- Oversized file and allocation claims; ZIP/compressed/nested archive payloads and content masquerading as another file type. Admission is bounded; no archive extraction occurs.
- File picker cancellation, share-sheet dismissal, interrupted download and unreadable destination. None is reported as “verified.” A manually selected saved file round-trips successfully on the other host using only its backup password.
- Restore into a fresh, differently seeded wallet. Notes decrypt and re-encrypt correctly without the original OS key/profile, while account keys, passkeys and seed remain unchanged.
- New/duplicate/conflicting notes in one file, duplicate UUIDs with different identities, differing harmless metadata and malformed final records. Preview counts are correct; conflicts or invalid records prevent the whole merge; existing records/reservations are never overwritten.
- Capacity just below/at/above the permitted union; zero partial imports, truncation or automatic cleanup. An explicit allowed capacity increase still requires a fresh merge preview.
- A backup claiming unspent while current chain says spent; a claimed completed/failed/unknown historical withdrawal; a duplicate with a live local reservation; an unfunded note; a lagging/forked public snapshot. No archived status or job reactivates spending or causes an automatic resubmission.
- Offline restore and subsequent reconciliation. Locally retained notes remain unusable for withdrawal until evidence is sufficient; network failure never becomes “unspent” or deletes the note.
- Kill the process at each staged write/commit/cleanup point; successful-but-unacknowledged writes; quota/disk-full/read failures; second concurrent restore; A -> B -> A profile changes. After restart there is one complete prior or committed state, never a partial import or duplicate execution.
- Verify actual OS task-switcher/screenshot policy, keyboard/autofill behavior, file privacy, low-memory cancellation, KDF latency and temporary-file cleanup on the lowest supported hardware. Browser/simulator success alone does not qualify native secret handling.

## 9. Implementation boundary and original rollout requirements

The enhancement adds shared functionality to **both** the extension and mobile. Its format and extension flow are implemented; the remaining mobile work must reuse them rather than serialize internal ciphertext or introduce a second format. The original rollout requirements below remain an acceptance checklist, not a claim that mobile work is complete.

Before code: approve the precise inventory scope, portable schema, cryptographic suite/KDF profile, file/parser limits, duplicate/conflict policy and journal protocol. Security review must cover the format and migration strategy. Record remaining decisions explicitly; this document is not that final cryptographic approval.

Then implement the pure codec/validation/merge planning and shared vectors; build separate file/auth/storage adapters; add read-only round-trip verification; exercise crash recovery; and finally expose export/import in both hosts behind a feature flag. Keep the current individual raw-note reveal/import flow available. Do not claim whole-vault backup support until both cross-host restoration and the complete failure matrix pass.

Acceptance evidence records exact code/dependency versions, schema/suite IDs, device/OS/browser, maximum tested counts/sizes, interruption point and outcome. Store release approval and any production-funds qualification remain separate decisions.

**Source references:** [raw-note backup dialog](../../../source/pages/Privacy/PrivateNoteBackupDialog.tsx), [no copy/download and stale-reveal tests](../../../source/pages/Privacy/PrivateNoteBackupDialog.spec.tsx), [single raw-note import](../../../source/pages/Privacy/PrivateNotes.tsx), [local private-vault/shard and journal structures](../../../source/scripts/Background/controllers/privateVault.ts), [public note/status types](../../../source/utils/privacy/privateVaultTypes.ts), [pool-wide public snapshot model](../../../source/utils/privacy/types.ts), [withdrawal uncertainty](../../../source/scripts/Background/controllers/privacyWithdrawals.ts), [recovery journal example](../../../source/scripts/Background/controllers/walletRecovery.ts), [existing parity design](./SECURITY_FLOWS.md).
