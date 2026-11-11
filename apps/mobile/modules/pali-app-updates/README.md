# Pali app updates

Android-only Expo local module using Google's Play In-App Updates SDK 2.1.0.
The platform adapter exports `checkAppUpdate`, `subscribeAppUpdates`,
`startAppUpdate(mode = 'flexible', signal?)`, and `completeAppUpdate(signal?)`.
Other platforms report unsupported; completing an unavailable update rejects.

Checks and install-state events are observations. They never launch a prompt,
resume an interrupted update, install, or restart the app. A start always fetches
a fresh `AppUpdateInfo`, verifies the same resumed host Activity, and checks the
requested update type. Store failures are distinguished from a successful
no-update result by `storeAvailable` and the optional numeric `storeErrorCode`.

The caller must obtain an explicit user action and enforce the wallet safety
gate before either mutation. Flexible updates wait for a separate explicit
`completeAppUpdate` call after download. Immediate mode is only for an explicit
critical-update action: Play's own immediate flow can install and restart after
the user accepts its prompt. Priority never selects immediate mode automatically.

Each mutation has a one-use native token. Aborting before the Play call removes
that token, including while `AppUpdateInfo` is pending or before the queued
native function begins. The token check and Play invocation are atomic with
respect to cancellation. After that boundary Play owns the action; abort does
not claim that an already launched Play flow was cancelled. Host pause revokes
preflight work, while the Play dialog's own pause is allowed. Host destruction
rejects pending promises; module destruction also unregisters the Play listener.

Adapter tests can run with `node --test modules/pali-app-updates/tests/adapter.test.ts`
from `apps/mobile`. These are dispatch/cancellation tests, not Android or Play
qualification. Signed Play-distributed builds and supported devices still need
validation of store availability, interrupted downloads, dialog cancellation,
flexible completion and immediate restart behavior.

Official API references:

- https://developer.android.com/guide/playcore/in-app-updates/kotlin-java
- https://developer.android.com/reference/com/google/android/play/core/appupdate/AppUpdateManager
