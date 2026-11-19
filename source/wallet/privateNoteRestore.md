# Private-note restore boundary

`privateVault.ts` exposes restore and export capabilities only on its internal
controller intersection. They are not in the message-facing vault interface.
The backup codec remains responsible for file decoding, cryptography, canonical
payload validation and format limits. `noteBackupHistory.ts` is the shared leaf
schema for inert historical evidence.

A preview accepts already-decoded entries and calculates a bounded pure merge.
Its opaque, frozen token contains counts and a random ID. The controller retains
only counts, digests, session identity and a five-minute deadline, with at most
four outstanding tokens. It retains no plaintext inventory between calls. Commit
requires the entries again, snapshots them before yielding, verifies the reviewed
source digest, consumes the token, obtains fresh wallet authentication, then
rechecks the current profile and complete inventory under the persistence mutex.
A change to capacity, receipt, notes or journals invalidates that preview. Failed
or cancelled tokens cannot be replayed.

Every newly restored note starts with a durable review guard, including backups
without history. An existing local record keeps its ID, timestamp, origin and
journals. Imported hints remain separate from local journals; both contribute
to the combined export and admission budget. Hints never recreate reservations,
proofs, relay endpoints or active jobs.

Imported history is provenance, not proof that a note is permanently blocked or
that an earlier payment was cancelled. Preparing a withdrawal reads the note and
its verified public-pool status under authenticated custody. Spent, missing or
unverified notes cannot proceed. The same read captures a hash of the retained
withdrawal history and bounded public summaries. The existing single-use intent
binds that history, the note, recipient, fees, mode and session.

Withdrawal uses the ordinary recipient and fee review. The backend copies the
captured history binding into the reservation and rechecks it before dispatch.
Changed history requires a new review. A pending direct withdrawal tracked in
Activity pauses another withdrawal of that note with the same fee payer.
Clear Activity for that payer releases the pause and older private-operation
nonce reservations. The encrypted attempts remain available for status checks,
including relayer job history. Every new withdrawal requires a verified unspent
note.

Available history and public inputs remain portable. Export stays available
while a transaction is pending. Imported hints remain historical records.
A duplicate raw import preserves the existing guard and journals. Restored notes
cannot become new deposits. The vault can still read receipts written by older
versions.

Importing new withdrawal evidence or an explicit reconciliation marker revokes
earlier admission. Recording an outcome remains permitted for its exact retained
attempt and changes the history seen by a later review. A copied bearer note may still be
held or used elsewhere; restoring it does not cancel previous withdrawals.

The one canonical version-1 writer always authenticates a required `restore`
root field, even when empty. The prior pre-release five-field root is accepted
only without per-note guards; its next write is canonical. Its old strict
five-field reader rejects the new six-field root, preventing silent guard loss.

Completed-note cleanup moves the complete secret and its journals into encrypted
archive shards. The optional authenticated `archiveCount` root field and each
archive reference's full identity digests bind their count and contents. Ordinary
active reads and writes preserve these ciphertext shards without decrypting or
deriving archived notes or querying their chain status. Explicit archive viewing,
authenticated reveal, backup and restoration can read them. Older strict root
readers reject the archive extension.

The archive has independent limits of 512 notes and 4 MiB, including its encrypted
root-index contribution. Active capacity remains 128, 256 or 512 notes with its
existing 4, 8 or 16 MiB quota. Both share the existing 16 MiB storage ceiling and
64 KiB encrypted-root bound. Failed admission or storage never evicts secrets.
Restoring an archived note requires authentication and an available active slot,
and retains all withdrawal history and review guards. Permanently clearing the
archive is a separate authenticated action that leaves active notes intact.

The shared limit is sixteen distinct history hints per note, counting imported,
retained and current local evidence together. Admission reserves one further
slot for an unknown deposit/direct withdrawal or a relay job awaiting its hash,
and two for an unknown relayed withdrawal. This prevents an accepted restore
from blocking subsequent acknowledgments or a complete export. The same
invariant is checked on load and before every write.

The preview and writer share the same pure shard grouping and root/bundle size
admission. Portable backup capacity does not imply a dense inventory fits this
vault: sixteen hints plus maximum-size existing journals can exhaust the fixed
64-KiB root or per-capacity byte budget before reaching 512 notes. Such an import
is rejected before a confirmation token is returned, without a write.

A per-profile token shared by all engines using the same persistence mutex is
invalidated synchronously before a restore write attempt. Reservation callbacks
capture this token under the mutex. The real MainController returns the resulting
fence to deposit/withdrawal orchestration, which checks it before send and in the
final SDK signing callback; the relay path also checks immediately before its
POST. In-flight proof results are rechecked after their final asynchronous
profile read. Failed writes conservatively revoke earlier signing admission;
late broadcast acknowledgments remain recordable.

The encrypted notes and latest restore receipt are one storage value, written
once through the host's whole-record atomic storage contract. If acknowledgment
is lost after the write, callers inspect the current-profile receipt and reload
the inventory instead of replaying the token. The receipt contains counts,
source digest, timestamp and token ID, not bearer notes. Export freshly
authenticates and reads only the current profile's exact storage key; retained
keys from other wallets are never enumerated as ownership.

Extension and mobile use the same encrypted backup, restore guard and explicit
withdrawal authority. Both hosts bind live recovery reads to the
captured wallet, account, network and session. A duplicate raw-note import
preserves the existing history and restore guard.
