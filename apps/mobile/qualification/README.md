# Native custody qualification

This is a separate, CI-only entrypoint with bundle/application identifier
`com.paliwallet.qualification`. The normal `index.ts` never imports it. The
configuration script refuses to run without explicit CI/qualification flags or
against an already modified production identifier. Use an isolated checkout.

The workflow builds release-mode iOS simulator and Android emulator binaries,
including the actual Expo modules, Hermes, SQLCipher and pinned software SDK.
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

After the first account's offline signature, full qualification creates HD index
1 through the real SDK, verifies active/first-account removal refusal, selects
index 0, removes index 1 before it has a journal, and restores index 1 to the
independently derived address. Both accounts retain real `attempted` transactions
in separate version-2 journal containers. Pending-journal removal must fail and
lock custody; no terminal receipt is fabricated. The restarted process must
already select index 1, recover both containers and signatures, and finish on
index 1. Reports contain only public identities, hashes and fixed success/version
fields, never seed words or serialized transaction bytes. Imported fixtures use
a fixed public expected address; generated wallets derive their own expectation.

After these existing cases, a separate ERC20 case creates HD index 2 and imports
a fixed public token descriptor. It uses the real native transfer controller,
software SDK and SQLCipher journal with a bounded injected Ethereum RPC; no
network service or real token contract is contacted. The create phase signs the
fixed zero-ETH-value ERC20 call, verifies its intent and durable bytes before the
injected submission, and simulates a lost response. The new process selects the
same HD2 account, checks its retained fingerprint, raw transaction and intent,
then explicitly reauthenticates and retries those exact signed bytes without a
new signature or metadata lookup. Both phases return to HD1 and prove that the
original HD0/HD1 native journals are unchanged.

Full reports require the ERC20 address, transaction and intent hashes, fixed HD2
identity, per-phase signature/authorization counters and exactly one injected
submission. Create/restart hashes and the wallet fingerprint must match. These
checks add native controller/signing/persistence evidence; they do not establish
live-network token execution or token-delivery behavior.

A separate native-coin case creates HD index 3 and signs two transactions with
the installed SDK: one on Ethereum and one on the fixed Syscoin NEVM testnet
(chain 5700). Both use nonce zero and retain distinct entries in the same
version-2 account journal. The new process selects HD3, verifies both signed
envelopes and hashes from durable storage without signing again, and returns to
HD1 on Ethereum. Both phases compare the complete prior HD0/HD1 native and HD2
ERC20 journal rows, so chain qualification cannot silently replace that evidence.
Full Android and physical-iPhone reports require the HD3 identity, both hashes,
chain 5700, journal version and phase-specific restart flag; each host runner
compares them across the cold restart. The limited iOS Simulator refusal occurs
before all HD, ERC20 and NEVM cases and cannot carry these success fields.

The full native crypto fixture runs through the actual bridge on each launch,
including unchanged 20k/900k KDF profiles and authentication-error classification.
JavaScript fetch/XHR/WebSocket requests are blocked. A fixed public-fixture Ethereum transaction is signed and journaled without broadcasting. Its hash and signed identity must survive the process restart. Only the ERC20 case's local injected RPC is allowed; no network RPC or broadcast is permitted. Reports contain case names/timings, public account identity,
opaque fingerprint, signed-transaction hashes and OS/build hashes; phrases, passwords, keys and database
contents are never exported into artifacts. A database read after process death
checks the SQLCipher header and absence of known fixture credential strings.
The NEVM case is offline signing and persistence evidence. It does not contact
the testnet, fund an account, broadcast, or qualify live 12-confirmation
settlement behavior. Passing source tests or building this harness alone does
not establish native execution; that requires the recorded native artifact run.

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
also never reaches SDK loading, indexed-HD operations or journal qualification. It
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

## Signed physical-iPhone harness

`run-physical-ios.cjs` is a separate host runner. It never falls back to
Simulator, changes production storage policy, or accepts a caller-selected app
identifier. It runs the same native creation/import, backup, wrong-password,
HD-account, offline ERC20 journal/retry and chain-5700 signing/restart checks described above. It does not
qualify the normal app's UI, Activity, physical privacy behavior, or live-network
transactions.

The physical runner requires the selected **Xcode 27 or newer** toolchain for
`devicectl --json-output -` support. Check `xcodebuild -version` before preparing
the signed fixtures; select the intended Xcode with `xcode-select` or
`DEVELOPER_DIR`. The runner checks that version before reading or copying apps,
creating evidence, or contacting a device. Missing, older, or unrecognized
version output stops with `XCODE_27_REQUIRED` and selection guidance.
This minimum applies only to the physical runner. The separate iOS Simulator
workflow and its Xcode 26.6 selection are unchanged.

The two fixed physical fixture identities are:

- Import: `com.paliwallet.qualification.physical.import`
- Generate: `com.paliwallet.qualification.physical.generate`

They have separate app containers and private Keychain groups. The production
app remains `com.paliwallet.mobile`; the existing simulator/Android fixture
remains `com.paliwallet.qualification`. Neither is a physical reset target.

### Pairing and signing

On iOS 27 or newer, open **Xcode → Open Developer Tool → Device Hub**, click
**+ → Pair Nearby Device**, and follow the prompts with the phone and Mac on the
same Wi-Fi network. On older iOS, pair initially with a cable. Enable Developer
Mode when prompted, unlock the phone and ensure it appears as available. See
[Apple's Device Hub instructions](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub).

Sign into your account in **Xcode → Settings → Apple Accounts** and select the
appropriate team with automatic development signing. A Personal Team can test
on a physical device, but has app/device limits and short-lived provisioning.
Do not share account credentials with the runner. A distribution-signed or
ad-hoc unsigned app is not accepted: development provisioning and private,
non-shared Keychain entitlements are required for these test containers. See
[Apple's signing instructions](https://developer.apple.com/documentation/xcode/building-and-running-an-app).

### Build two immutable fixtures

Start from an approved clean commit. Make two isolated source copies of that
commit; do not reuse a generated iOS project from an older worktree. In each
copy, install only the locked mobile dependencies, then run the configuration
script with the matching fixed scenario:

```sh
npm ci --ignore-scripts
CI=true PALI_NATIVE_QUALIFICATION=1 \
  PALI_PHYSICAL_QUALIFICATION=import GITHUB_SHA="$PALI_REVIEWED_COMMIT" \
  node scripts/configure-native-qualification.cjs

EXPO_NO_TELEMETRY=1 npx --no-install expo prebuild --platform ios --no-install
(cd ios && pod install)

xcodebuild -workspace ios/PaliPhysicalImport.xcworkspace \
  -scheme PaliPhysicalImport -configuration Release -sdk iphoneos \
  -destination "id=$PALI_DEVICE" -derivedDataPath "$PALI_IMPORT_BUILD" \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$PALI_TEAM" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

For the second copy use `PALI_PHYSICAL_QUALIFICATION=generate`,
`PaliPhysicalGenerate.xcworkspace`, `PaliPhysicalGenerate` and a separate build
directory. These commands build but do not install the apps. The configuration
script binds each signed Info.plist to the source revision, scenario and actual
mobile lockfile digest; OTA updates remain disabled. Record and review each
artifact's `CDHash` from `codesign --display --verbose=4 <app>` with the source
and build evidence before running the harness. Pass those recorded hashes;
never substitute a freshly recalculated hash to bypass a mismatch.

Run the harness from the original clean approved checkout, using the signed
`Release-iphoneos` app paths and an output directory that does not yet exist:

```sh
CI=true PALI_NATIVE_QUALIFICATION=1 node qualification/run-physical-ios.cjs \
  --device "$PALI_DEVICE" --source-revision "$PALI_REVIEWED_COMMIT" \
  --import-app "$PALI_IMPORT_APP" --import-cdhash "$PALI_IMPORT_CDHASH" \
  --generate-app "$PALI_GENERATE_APP" --generate-cdhash "$PALI_GENERATE_CDHASH" \
  --output "$PALI_NEW_EVIDENCE_DIRECTORY"
```

The runner validates both artifacts before any device mutation, checks that
CoreDevice reports a paired, connected, booted **physical iPhone** with developer
services available, then installs only the two fixed fixtures. It refuses any
pre-existing fixture installation by default. It captures the PID and executable
from its own launch receipt and rechecks both before termination; a reused PID
is never killed. Reports bind a fresh random run ID, source and bundle identity,
so a stale report cannot satisfy a later run. Each report must pass the shared
native validators plus complete physical crypto/check evidence. Create/restart
must preserve account, fingerprint, HD, ERC20 and chain-5700 transaction identity while the
native process session changes.

Before contacting a device, the runner copies the admitted apps into a private
`.verified-artifacts` directory inside the new evidence directory. It rejects
symlinks and special files, bounds each file, total bytes, entry count and depth,
and verifies the copied signatures and complete tree hashes against admission.
Every install, including reset reinstallation, uses those snapshots and repeats
signature, identity and tree-hash checks. A concurrent rebuild of the original
app paths cannot change the installed snapshot. The snapshots are retained with
the evidence and use owner-only permissions; this is protection against ordinary
mutable-input races, not a filesystem immutability guarantee against malicious
code running as the same host user. The operator must keep that host trusted.

Copied reports and database samples use fresh temporary paths. Cleanup is attempted on
success, command failure and invalid/oversized copies without following symlinks
or recursively deleting unexpected directories; unexpected nonempty directories
are preserved and the run fails. In-memory copy buffers are
cleared after validation, including rejected reports and database samples.

A per-device host lease prevents two local runners from sharing an app process.
If a runner is killed, its lease remains and blocks another run. Inspect the
recorded host PID and confirm that no qualification process remains before an
operator removes that specific stale lease; it is never automatically expired.

The code targets the CoreDevice JSON fields checked in its mocked tests. An
unrecognized Xcode response fails closed; do not change a parser or bypass a
gate during a run. Review and retest any adapter change against captured,
redacted structure first.

### Explicit fixture reset for repeated runs

Uninstalling an iOS app can leave its Keychain values. Reinstalling it is not
evidence of a fresh wallet. For a deliberately fresh repeat, add
`--reset-fixtures` to the same command after reviewing the two app identities.
This flag authorizes destruction of **only the dedicated physical fixtures**.

The runner first installs the reviewed signed fixture over its existing copy.
It launches a qualification-only reset command with a fresh nonce, deletes only
that fixture's fixed database-wrapping Keychain key, and requires an exact
nonce/source/bundle-bound acknowledgement plus a null key readback. Only then
does it uninstall that allowlisted fixture's app container and reinstall the
same reviewed artifact. Reset code never opens a wallet, deletes a filesystem
path, accepts a key/service argument, or appears in the production entry graph.
Failure stops the run; it never authorizes a production reset or silent repair.

### What the result means

A passing `physical-ios-qualification.json` qualifies the recorded signed
fixture and phone/OS for these offline custody and persistence cases. It does
not qualify the normal wallet's interaction, accessibility, app-switcher or
lock-screen privacy, clipboard behavior, Activity, notifications, hardware
wallets, or a live transfer. Test those separately with disposable wallets in a
fresh build of the same approved source. Never capture recovery words or copy
them to the clipboard as test evidence. Actual live testnet transfers require a
reviewed supported signing-network configuration; changing a mainnet endpoint
is not an acceptable substitute.
