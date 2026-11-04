# Internal BIP84 watch-session preparation

The existing `WatchOnlyAuthority` has an internal `openRecords` factory. It reads
through the existing record repository, validates the stored/public projection,
and privately binds each canonical BIP84 source to a synchronous public derivation
closure. The closure's `/0/0` must equal the stored first receiving address. It
never creates another selector, storage writer or signing authority. Read errors
reject opening; a genuinely empty record store remains a valid empty state.

No production adapter or route is wired. The ordinary three-argument constructor
is unchanged, and its snapshots omit `accountObservation`. Public SDK2.1
publication, adapter, real-vector validation and complete UI integration remain
required before enabling account-key watching.

Factory cancellation applies only to admission. Its abort listener is removed
on resolve/reject; callers use the returned owner's lock/cancel APIs afterward.
Opening binds public data locally and makes no discovery/network requests.
`refresh()` is the future explicit-consent operation. It dispatches by internal
source kind, retaining existing address reads for address records.

For a BIP84 source, refresh starts at zero with the committed bounded scanner.
`continueDiscovery()` only continues that same live source's successful partial
pass, never a cold-restored cursor or an exhausted index range. The single-flight
slot is reserved before observer or validation callbacks. Reloads must match the
full captured record/projection, including names and other saved accounts;
external rename/removal/source changes require reopening the authority.

`accountObservation` contains key-free policy/account/network metadata, observed
confirmed and signed pending amounts, coverage, sampled anchor and partial state.
It is separate from `balance`, which stays unknown for a BIP84 source. These are
bounded observations, not spendability, provider truth, an atomic account balance
or complete history. Loading/error/cancellation clears totals. A successful result
is published only after current-context checkpoint acknowledgement. The source
key, derivation closure and repository tokens never enter the public snapshot.

Account/network changes, A–B–A, lock and public-screen cancellation immediately
clear/cancel the scanner. Its request/generation/source binding must still match
before reads, after awaits and before checkpoint dispatch. Already-dispatched
writes remain draining; no new BIP84 operation overlaps them. Late observations
and failures cannot republish into a newer context.

The existing repository's checkpoint API accepts an optional synchronous guard.
Before dispatch, the guarded path checks before/after SDK-validation callbacks, after the awaited
current read, and immediately before dispatching its one write. Async/non-undefined
guards reject. Pre-dispatch cancellation consumes the attempt without declaring
durable data corrupt, including when a validation callback throws after revoking
the operation. Genuine validation errors while current still refuse the save.
The source record and checkpoint comparison remain the
same full-document CAS; no document/schema change was added.

Once `set` has been dispatched while current, lifecycle cancellation cannot undo
it. The exact old-source advisory checkpoint may become durable. The repository
still drains and verifies the write/readback; the owner discards its late result,
never claims rollback and never silently replays it. Failed or ambiguous saves
hide totals and discard continuation state; future work revalidates storage and
changed records require a fresh owner. No new store or compensating write exists.

Cancellation hides observations immediately, but the repository and its admission
slot still depend on pending storage reads/writes settling. A permanently hung
storage port cannot be made responsive by this controller; bounded native storage
completion and real SDK latency remain qualification requirements.

Deterministic tests use the actual repository, scanner and bounded usage reader
with an injected synthetic public deriver and response fixture. They establish
host contracts, not real SDK derivation or native device behavior. No custody,
import route, payment QR, notification, global fetch or endpoint change is made.
