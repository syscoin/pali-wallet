# Native custody qualification

This is a separate, CI-only entrypoint with bundle/application identifier
`com.paliwallet.qualification`. The normal `index.ts` never imports it. The
configuration script refuses to run without explicit CI/qualification flags or
against an already modified production identifier. Use an isolated checkout.

The workflow builds release-mode iOS simulator and Android emulator binaries,
including the actual Expo modules, Hermes, SQLCipher and pinned software SDK.
The iOS Simulator job checks native crypto and an expected protected-storage
refusal. It does not qualify custody. The Android job retains the full custody
and cold-restart checks below. Both jobs also require the native HTTP companion
described below before any protected-storage admission.

## Offline native HTTP companion

The native CI workflow always sets `PALI_NATIVE_HTTP_QUALIFICATION=1`. This gate
adds a loopback-only cleartext exception to the isolated fixture configuration;
the production app configuration, TLS validation and safety plugin are unchanged.
It is incompatible with physical qualification. The companion requires an
immutable `GITHUB_SHA` and binds each report to that source, the lockfile hash,
the app session, phase and a fresh 128-bit public run token.

The host starts a separate Node child bound exclusively to `127.0.0.1` on an
ephemeral port. Android requires the selected target to be an emulator and uses
a serial-bound, non-replacing `adb reverse` mapping; cleanup removes only that
owned port. No external service, wallet address or faucet is contacted. The
fixture serves only fixed allowlists of token-bound GET and POST routes and has no proxy.

The actual production `walletFetch` adapter exercises Expo's compiled native
fetch path while global fetch, XHR and WebSocket remain forbidden. A separate
Expo fetch call seeds a public, short-lived cookie for a positive control; the
wallet request must omit it. Other cases require an unchanged GET URL, refusal
to follow a redirect (zero target requests), abort before headers and during a
body, socket closure after a body-size rejection, and a healthy later request.
The host independently checks exact request counts and close evidence before
accepting the strict `pali-native-http-<token>.json` sidecar. Missing, stale,
extra-field or inconsistent evidence fails qualification. Owned timers, sockets,
child processes and reverse mappings are closed on failure as well as success.
The existing `networkCalls: 0` records forbidden global transport attempts; the
separate host audit records the explicit local native HTTP requests.
Failed HTTP cases write only a fixed case label, with best-effort bounded partial
server counters and stream-close flags collected before shutdown. These records
are explicitly failed diagnostics and cannot satisfy the passing sidecar schema.
Ambiguous reverse-install timeouts or transport loss permit cleanup only after
prior absence and exact serial/port readback; collisions and unknown ownership
never authorize removal.

GET and POST execute after native crypto qualification and before storage admission.
The iOS Simulator's original failed storage report and refusal schema remain
unchanged; its aggregate may claim `nativeHttpQualified: true` while retaining
`custodyQualified: false`. This proves local HTTP adapter behavior only. It does
not qualify public RPC availability, production TLS handshakes, fixed-network
balance semantics, native memory ceilings or physical-device networking. Node
fixture tests are controls; the compiled native CI run is required evidence.

### Native POST and JSON-RPC gate

The five POST cases are separate from the unchanged seven GET cases and their
v1 report/audit schemas. `post-native.ts` exercises the actual
`createBalanceReader` JSON serialization and parsing with a qualification-only
exact-origin mapping to the owned loopback fixture. It never dispatches to the
public RPC URL. The host compares complete received UTF-8 bodies against fixed
literal fixtures, verifies JSON headers/cache policy/cookie omission, and records
only byte lengths and SHA256 digests rather than raw bodies.

The cases cover an exact large integer and valid zero; mismatched ID, JSON-RPC
error, malformed JSON and wrong MIME; declared and streamed 16 KiB response
limits; cancellation after the full request body reaches the host and a healthy
later POST; and one lost response followed by an explicit replay of identical
synthetic bytes. No key, signature, signed transaction or live provider is used.
The replay is a transport check. Real transaction retries preserve signed
payload bytes while their JSON-RPC IDs can change; this gate does not replace
the existing journal-backed cold-restart evidence.

Each launch requires `pali-native-post-<token>.json`, bound to the same immutable
source/lock, platform, phase, scenario and native session as its GET sidecar.
The host takes one final atomic GET+POST audit, validates both, and saves the
unchanged `<platform>-<scenario>-<phase>-http.json` plus a separate `-post.json`.
Only then can the aggregate set `nativePostQualified: true`. Old GET-only
artifacts cannot satisfy the new gate. Failed POST diagnostics use a different
kind and cannot be accepted as success.

Request bodies are bounded at 8 KiB, responses retain production 16 KiB limits,
and all fixture body reads, control waits, paced streams and sockets are bounded
and closed on failure. Sidecar filenames are fixed token names; iOS host reads
use no-follow/nonblocking regular-file checks and an 8 KiB consumed limit.
Android rejects nonregular/symlink paths, caps output and has a 5-second command
deadline; it does not claim atomic filesystem exclusion against a concurrently
changing app file. Diagnostics preserve the original failure.

The source-map preservation CLI checks every embedded project source against
the exact build checkout and requires all 60 prior c960 project modules plus
`post-native.ts`, `post-contract.ts` and `post-fixtures.ts`. Native artifact
review must retain that complete binding, independently hash the lockfile and
ZIP/map bytes, verify all five launch pairs, and preserve all Android custody
and restart checks. On iOS the original storage-refusal report stays failed,
with `custodyQualified: false` and `sdkSmokeVerified: false`, even when both
transport gates pass. No native pass is claimed by the Node controls alone.

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
index 0, removes index 1 before it has a journal, and uses SDK account creation
to reuse index 1 with the independently derived address. Both accounts retain real `attempted` transactions
in the shared sender-owned signed-record bundle. Pending-journal removal must fail and
lock custody; no terminal receipt is fabricated. The restarted process must
already select index 1, recover both senders' records and signatures, and finish on
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
then explicitly confirms retry in the current unlocked session and resends those
exact signed bytes without a new signature, password check or metadata lookup. Both phases return to HD1 and prove that the
original HD0/HD1 native journals are unchanged.

Full reports require the ERC20 address, transaction and intent hashes, fixed HD2
identity, per-phase signature/unlocked-session admission counters and exactly one injected
submission. Create/restart hashes and the wallet fingerprint must match. These
checks add native controller/signing/persistence evidence; they do not establish
live-network token execution or token-delivery behavior.

A separate native-coin case creates HD index 3 and signs two transactions with
the installed SDK: one on Ethereum and one on the fixed Syscoin NEVM testnet
(chain 5700). Both use nonce zero and retain distinct entries in the same
shared signed-record bundle. The new process selects HD3, verifies both signed
envelopes and hashes from durable storage without signing again, and returns to
HD1 on Ethereum. Both phases compare the complete prior HD0/HD1 native and HD2
ERC20 journal rows, so chain qualification cannot silently replace that evidence.
Full Android and physical-iPhone reports require the HD3 identity, both hashes,
chain 5700, journal version and phase-specific restart flag; each host runner
compares them across the cold restart. The limited iOS Simulator refusal occurs
before all HD, ERC20, NEVM and zkSYS cases and cannot carry these success fields.

The zkSYS case uses a separate HD index 4 account on fixed chain 57057. It runs
the actual native transfer controller with a bounded injected RPC, including
fee selection before estimation and confirmation's re-estimation of the exact
approved type-2 cap and zero priority fee. The injected suggestion changes
before confirmation; the approved fee fields remain unchanged. The installed
SDK signs once, the journal records the bytes before submission, and a lost
injected response leaves the transaction unresolved. After process restart,
the controller requires password authorization and retries those same bytes
with no new signature or fee estimate. Both phases preserve the complete HD0–3
journal rows and finish on HD1/Ethereum. Reports require HD4 identity/hash,
chain/version, and fixed per-phase signing, authorization, estimate and injected
submission counters. Both host runners match this evidence across restart.
After all five account cases return to HD1, each full launch uses the real
`HdKeyExportFlow`, native authority and installed SDK runtime to authenticate
and reveal HD1's private key. It derives and compares the public address
internally, cancels/disposes the presentation and clears local references.
The catalogue, fingerprint and complete HD0–4 journal rows must remain unchanged.
Only `nativeHdKeyRevealVerified: true` is added to the report, bound to its existing
selected HD1 identity. No key, seed, raw key hash or clipboard output is emitted.
Full Android and physical-iPhone validators require this proof on both create
and restart; the limited iOS refusal rejects it. This code is qualification
support, not evidence of a native run until the corresponding artifact passes.
These are development qualification cases. They do not establish deployed
zkSYS fee/finality behavior, native execution without an artifact run, or live
transaction acceptance; those remain separate pre-merge and pre-broadcast gates.

The full native crypto fixture runs through the actual bridge on each launch,
including unchanged 20k/900k KDF profiles and authentication-error classification.
JavaScript fetch/XHR/WebSocket requests are blocked. A fixed public-fixture Ethereum transaction is signed and journaled without broadcasting. Its hash and signed identity must survive the process restart. Only the ERC20 case's local injected RPC is allowed; no network RPC or broadcast is permitted. Reports contain case names/timings, public account identity,
opaque fingerprint, signed-transaction hashes and OS/build hashes; phrases, passwords, keys and database
contents are never exported into artifacts. A database read after process death
checks the SQLCipher header and absence of known fixture credential strings.
The NEVM case is offline signing and persistence evidence. It does not contact
the testnet, fund an account, broadcast, or qualify live transaction acceptance
and receipt handling. Passing source tests or building this harness alone does
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

CI invokes `node --import ./scripts/register-shared-test-dependencies.mjs qualification/run-native.cjs ios <app> --ios-simulator-contract`. This explicit mode
binds to the explicitly selected installed Simulator runtime and an `iphonesimulator` application. It
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
ordinary app commands, including binary database/screenshot reads, retain a
three-minute limit. Application report deadlines remain five minutes. Failures
produce a bounded platform failure artifact with the original command, status,
error/timeout classification and diagnostic tails after best-effort cleanup.
Binary database output is never included in that artifact.

Android setup bounds each connection/root command to 30 seconds and the UID
probe to 10 seconds. One exact `adb root` closed-transport error may proceed to
reconnection, but app installation requires an explicit UID 0 readback. The
original root error is retained in `android-root-readiness.json`; nonroot,
nontransient errors and failed reconnection stop the run. No app action is retried.
Before each iOS app launch, a separate 30-second readiness deadline requires the
exact newly created simulator UUID to be available under the selected runtime,
Booted, and running SpringBoard. Missing, ambiguous or malformed inventory,
truncated service inventory, or an already-running qualification app stops the
run. Only readiness probes repeat; the app launch does not.
`ios-<scenario>-<phase>-readiness.json` records that proof or its failed stage.
`ios-<scenario>-stages.json` records running/completed/failed setup, launch and
report stages with bounded elapsed times and no command output.
Measured readiness overruns remain visible, with explicit deadline and duration
truncation flags. Once creation returns a validated owned UUID, cleanup still
runs if persisting that stage fails; unvalidated identities are never cleaned.

An iOS launch failure records up to two ten-second diagnostic probes before
deleting the owned simulator. The log query covers the full launch wait plus a
minute of margin, rounded up to minutes and capped at 15 minutes. Version 2 of
`ios-<scenario>-<phase>-launch.json` contains only service flags, log-category
counts and explicit window/truncation/parse-confidence flags, not raw messages.
Counts marked complete apply only to the queried system processes and messages
containing the qualification package marker; they do not prove an absence of
other errors. The launch is never repeated or treated as successful by these
diagnostics. These runner changes are not evidence that an earlier launch stall
has been fixed; a new exact-head artifact run remains required.

## Signed physical-iPhone harness

`run-physical-ios.cjs` is a separate host runner. It never falls back to
Simulator, changes production storage policy, or accepts a caller-selected app
identifier. It runs the same native creation/import, backup, wrong-password,
HD-account, private-HD-key reveal, offline ERC20 journal/retry and chain-5700/57057 signing/restart checks described above. It does not
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
CI=true PALI_NATIVE_QUALIFICATION=1 node --import ./scripts/register-shared-test-dependencies.mjs qualification/run-physical-ios.cjs \
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
must preserve account, fingerprint, HD, ERC20 and chain-5700/57057 transaction identity while the
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

## Imported EVM accounts (unmerged candidate)

The offline qualification entry creates and retires public fixture Imported ordinal 0, imports a different public fixture at ordinal 1, and uses the actual native authority, SDK private-record AEAD storage, selected-key reveal and NativeTransfers controller. It writes attempted journals on Ethereum, NEVM testnet and zkSYS using injected bounded RPC responses. A cold restart rehydrates the same imported key and retries only the saved signed bytes: three authorizations, no new signatures. All HD0–4 journal bytes and the original SDK vault pair/fingerprint are checked before and after; HD1/Ethereum is restored at the end.

Strict report fields contain only the imported account identity, three chain IDs and transaction hashes, counters and verification flags. They never contain the key, seed, envelope, ciphertext, profile ID or a key hash. Android and physical-iOS runners require this evidence and compare every chain across restart. Simulator storage-refusal evidence still cannot claim custody or imported-account success. Node tests and JavaScript exports do not establish native execution, screen privacy or live transactions. Do not fund these public fixture keys. The RPC is injected, and the harness makes no real balance request or network broadcast.


### Exact SDK and simulator selection

Configuration reads the installed mobile keyring package metadata and requires it to match the exact package.json pin. The same version is embedded in the qualification build and verified by the loaded SDK metadata before reporting success. An unreviewed package, version range or mismatched installation cannot satisfy the gate.

The local iOS runner selects the newest available standard iOS runtime and an installed iPhone device type. PALI_IOS_SIMULATOR_RUNTIME and PALI_IOS_SIMULATOR_DEVICE_TYPE can select exact installed identities; an unavailable explicit selection fails instead of falling back. The hosted workflow intentionally pins iOS26.5, while a local27.2 run binds its refusal report to27.2. Simulator refusal still proves no custody. All Node qualification commands use the existing shared-source dependency resolver so the mobile-only npm installation is authoritative.
