Account alerts are explicitly enrolled per account and exact network registration.
They inspect the same public EVM/Blockbook history and guardian observations as
the wallet, including activity signed elsewhere. They never load a spending root,
sign a transaction, or take defensive actions.

Only public enrollment metadata, normalized observation baselines and opaque
event records are persisted in a separate SQLCipher database. Its dedicated
SecureStore encryption key requires no biometric interaction and is available
after the first device unlock. The separate native directory has matching iOS
file protection and backup exclusion, or Android noBackupFilesDir. This has a
different availability boundary from the spending database; custody protection
and its key are not changed. New enrollment is explicit; corrupt storage fails
closed and cannot silently create a new enrollment.

The native entry imports backgroundTask at module scope before UI mounting. The
task qualifies the existing crypto provider, then opens only monitoring storage.
Foreground and OS tasks share normalized facts and durable deduplication. A
maximum of eight scopes is attempted per run, with a rotating cursor, bounded
public reads and abort deadlines. Initial history and guardian state establish a
silent baseline. Posting records a durable attempt before calling the OS: a
process interruption can lose a notice rather than replay it. Revocation removes
the enrollment under the same exclusive transaction lock, then cancels scheduled
and delivered IDs. Posting revalidates before and after the OS call, removing a
notice if revocation won that race. The OS callback never runs under the database
lock. Later enrollment has a fresh generation.

Each account is revalidated against persisted enrollment immediately before its
read, and local revocation aborts its in-flight reader. Transient delivery errors
retain a foreground retry once per minute. Unavailable monitoring must reload
and validate storage and permission before any further public account read.

Lock-screen text is always generic. The only notification payload field is a
random local event ID. Taps resolve that ID against current enrollment and must
pass the caller's current account/network check after unlock before routing.

Background delivery is best effort. Expo BackgroundTask requests a 15-minute
minimum interval; iOS chooses its own execution windows and the OS can delay or
stop work. Force-quit, power/network limits, permission denial and unavailable
storage can prevent delivery. These alerts are not an instantaneous guardian
alarm. No remote push service is enrolled.
