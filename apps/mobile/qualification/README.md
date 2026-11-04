# Native custody qualification

This is a separate, CI-only entrypoint with bundle/application identifier
`com.paliwallet.qualification`. The normal `index.ts` never imports it. The
configuration script refuses to run without explicit CI/qualification flags or
against an already modified production identifier. Use an isolated checkout.

The workflow builds release-mode iOS simulator and Android emulator binaries,
including the actual Expo modules, Hermes, SQLCipher and published software SDK.
The iOS Simulator job checks native crypto and an expected protected-storage
refusal. It does not qualify custody. The Android job retains the full custody
and cold-restart checks below.
The qualification entry defers all wallet/ethers/BIP39 imports until the native
crypto gate has completed. During fresh generation, a bounded in-memory observer
delegates RNG requests to the qualified native provider and verifies that the
actual SDK-generated mnemonic decodes to one of its 128-bit entropy outputs.
Only the verification boolean is reported; observed entropy buffers are cleared.
This also detects a dependency that captured an earlier global RNG at import.

The default full qualification mode runs both public-mnemonic import and fresh random generation. Each scenario
creates a wallet, verifies a fresh password-backed seed challenge, records the
wallet-bound backup receipt, tests lock/wrong-password/correct-password, then
leaves the database open. The runner terminates that OS process and relaunches
the same installed app/data. A changed native session ID, matching public address
and matching encrypted-vault fingerprint establish the tested cold restart.

The full native crypto fixture runs through the actual bridge on each launch,
including unchanged 20k/900k KDF profiles and authentication-error classification.
JavaScript fetch/XHR/WebSocket requests are blocked. No transaction is prepared,
signed or broadcast. Reports contain case names/timings, public account identity,
opaque fingerprint and OS/build hashes; phrases, passwords, keys and database
contents are never exported into artifacts. A database read after process death
checks the SQLCipher header and absence of known fixture credential strings.

Fresh iOS simulator devices isolate scenarios, including Keychain state. Android
uninstalls only the dedicated qualification package between scenarios. The runner
refuses production identifiers and never touches a user's installed Pali app.

This proves only the emulator, binary and source revisions recorded in the full
qualification artifacts. Physical-device file protection, app-switcher privacy,
backup/D2D behavior, power-loss durability and device performance require separate testing.
No successful CI result alone is a production release authorization.

## iOS Simulator contract and physical-device release gate

Apple's [Simulator guidance](https://developer.apple.com/forums/thread/780632)
explains that `FileManager` does not implement lock-based file protection there.
Production storage still requires complete protection, 0700/0600 permissions,
and the requested/read-back backup-exclusion policy. Missing, weaker or unknown
protection is an error. The [typed URL protection readback](https://developer.apple.com/documentation/foundation/urlresourcevalues/fileprotection)
uses fresh resource values and never infers success from an absent value.
The backup flag is an advisory [backup policy request](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup),
not a guarantee that a file will be omitted. SQLCipher and the ThisDeviceOnly
keychain key are separate controls.

CI invokes `run-native.cjs ios <app> --ios-simulator-contract`. This explicit mode
requires the pinned Simulator runtime and an `iphonesimulator` application. It
runs native process/Hermes checks, all native crypto vectors and opaque-handle
checks, then attempts the unchanged production storage open. Only a specific
`STORAGE_UNAVAILABLE` refusal classified as missing, none, unless-open or
until-first-authentication protection is expected. Other failures, incomplete
crypto, unexpected report fields and actual custody success all fail this mode.
No storage fallback, reset or simulated successful wallet is used.

The original `ios-import-create.json` remains a **failed** app report. The
separate `ios-simulator-limited.json` has `status: "limited"` and
`custodyQualified: false`, carries the source/binary identity and fixed refusal,
and explicitly records that no SDK smoke check was run. This mode never writes
`ios-qualification.json`, reads a wallet database or attempts cold restart. It
refuses output directories containing a full-custody aggregate. Consumers must
not accept this limited artifact as full custody evidence. Omitting the flag
retains the original full-custody validation, which fails on this storage refusal.

Before any iOS release, a **signed physical-iPhone** build must pass real
protected-storage create/import, password/backup flows, two-process cold restart,
and lock-screen/app-switcher/screenshot privacy checks on supported devices.
Record exact source, dependency, binary, signing/device and OS identities.
Simulator build/crypto/refusal evidence cannot satisfy that release gate.

Cold iOS simulator boot readiness has a separate ten-minute command budget;
ordinary commands, including binary database/screenshot reads, retain a
three-minute limit. Application report deadlines remain five minutes. Failures
produce a bounded platform failure artifact with the original command, status,
error/timeout classification and diagnostic tails after best-effort cleanup.
Binary database output is never included in that artifact.
