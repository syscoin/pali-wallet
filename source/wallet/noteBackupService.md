# Encrypted note-file orchestration

`createNoteBackupService` composes the portable codec and the private-vault
restore controller. It is shared authority code; it has no browser, filesystem,
network, UI or global lifecycle dependency. Hosts supply cryptography, a monotonic
clock, expiration scheduling and synchronous wallet-session invalidation.

One opaque operation can be reserved at a time. The reservation must be made
before a slow operation so a disappearing UI can cancel it by ID. Cancellation
revokes the operation immediately; admission remains closed until any running
KDF settles. A reservation and all staged data expire after five minutes.

An export requires fresh wallet authentication and encrypts one validated
snapshot of the complete current profile. Returned bytes are a separate copy.
Verification compares a selected file with the exact exported ciphertext and
opens it using the supplied file password. It does not import notes or record a
durable backup guarantee. Successful verification consumes the reservation.

Import preparation decrypts and validates the file, retains one bounded private
inventory in the authority, and returns only counts and an opaque ID. Commit
consumes the preview, reauthenticates the wallet, and invokes the core's atomic
merge. Existing records and reconciliation guards follow the core policy. A
preview is not an authorization to sign, broadcast or resume a transaction.

After a commit attempt, only a public receipt correlation is retained until the
original deadline. An operational error is reported as unconfirmed because an
atomic write may have succeeded before its acknowledgement was lost. An explicit
receipt read can confirm that exact plan and counts in the same live wallet
session. `null`, cancellation, expiry or a restarted worker is not evidence that
the write failed; callers must never automatically replay the commit. Lock or
profile changes discard the correlation as well as staged private data.

The extension adapter transports only bounded canonical base64 ciphertext and
public summaries. Its callers must disable automatic reconnect retries. The
authority drops references to note strings and keys on cleanup; managed memory
does not permit a claim of provable zeroization. Byte buffers owned here are
cleared when released. Individual note reveal/import remains a separate flow.
