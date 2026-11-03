# Native custody qualification

This is a separate, CI-only entrypoint with bundle/application identifier
`com.paliwallet.qualification`. The normal `index.ts` never imports it. The
configuration script refuses to run without explicit CI/qualification flags or
against an already modified production identifier. Use an isolated checkout.

The workflow builds release-mode iOS simulator and Android emulator binaries,
including the actual Expo modules, Hermes, SQLCipher and published software SDK.
The qualification entry defers all wallet/ethers/BIP39 imports until the native
crypto gate has completed. During fresh generation, a bounded in-memory observer
delegates RNG requests to the qualified native provider and verifies that the
actual SDK-generated mnemonic decodes to one of its 128-bit entropy outputs.
Only the verification boolean is reported; observed entropy buffers are cleared.
This also detects a dependency that captured an earlier global RNG at import.

It runs both public-mnemonic import and fresh random generation. Each scenario
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

This proves only the simulator/emulator, binary and source revisions recorded in
the artifacts. Physical-device file protection, app-switcher privacy, backup/D2D
exclusion, power-loss durability and device performance require separate testing.
No successful CI result alone is a production release authorization.
