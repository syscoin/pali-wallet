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

**Review restored note** requires a fresh wallet password. The authority reloads
the note under the shared persistence mutex and requires an existing verified
public-pool observation before and immediately before the write. That observation
is the verifier-owned local snapshot, subject to its existing 45-minute freshness
policy; this action does not make a live or note-specific RPC request. Missing,
spent or unverified notes do not gain review consent. The local-only `reviewedAt`
field records this consent, not exclusive ownership or cancellation of another
proof. It is strictly validated in encrypted storage and never accepted from or
exported in a portable backup.

A reviewed note with no imported withdrawal hints may enter the ordinary
withdrawal flow, which still requires its own current snapshot, proof, explicit
review and submission guards. Deposit-only history does not block this review.
Imported unknown/submitted withdrawal hints and unresolved local withdrawals
remain blocked. Exact known failed-local-withdrawal recovery may run without
clearing the restore guard; it preserves all metadata and uses its existing
transaction/proof checks. Restored notes can never be reused as new deposits.

Importing new withdrawal evidence or an explicit reconciliation marker revokes
local review consent. Recording the outcome of an existing local attempt remains
permitted and does not itself revoke consent. A copied bearer note may still be
held or used elsewhere; restoring it does not cancel previous withdrawals.

The one canonical version-1 writer always authenticates a required `restore`
root field, even when empty. The prior pre-release five-field root is accepted
only without per-note guards; its next write is canonical. Its old strict
five-field reader rejects the new six-field root, preventing silent guard loss.

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

The extension implements encrypted whole-note backup/restore and the explicit
ordinary-note review action. Imported withdrawal histories still need a separate,
evidence-specific reconciliation path; this review cannot clear them. The
single raw-note import policy is unchanged, and a duplicate raw import preserves
the existing restore metadata and history. Mobile file and review integration
remain separate implementation work.
