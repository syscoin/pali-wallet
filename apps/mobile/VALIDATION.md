# Mobile foundation validation

## Current source status

The native development flow implements creation/import, password unlock, seed backup, multiple seed-derived Ethereum accounts (create/select/rename/remove/restore), and per-account ETH portfolio, receive and send operations. SQLCipher storage retains the signed-transaction journal before submission. Watch-only accounts and design previews remain separate. Full extension feature equivalence remains incomplete. An end-to-end native testnet transfer, physical-device behavior and signed release artifacts remain unqualified. This paragraph records source status, not new execution evidence; see [README.md](README.md) and [SECURITY.md](SECURITY.md) for current scope and release gates.

## Historical foundation validation — November 2, 2026

The following results and limitations describe the earlier watch-only snapshot, not the current native implementation. Design/source baseline: `4470e54e8777cca2a4fe7c712409f60eeb4fa401`. That draft was based on the shared-foundation stack through `4ec602086`; its mobile diff did not change extension source, manifest or root dependencies.

That snapshot was a React Native watch-only first slice, not a qualified self-custody release. The supplied video and 32-screen PDF were design references. The matching demo source was not available in the inspected public repositories.

| Check | Observed result |
| --- | --- |
| TypeScript | Pass with strict checking |
| Domain and RPC contracts | 18 tests pass: exact amounts, malformed inputs, unavailable versus zero, wrong-chain rejection, cancellation, A-B-A context changes, stale responses, bounded parsing, signing refusal |
| Browser interaction | 7 tests pass: inert preview send/receive, public-address validation, no browser persistence, real activity filters, modal/navigation behavior |
| Layout viewports | 320x568, 390x844, 844x390, 768x1024 checked in Chromium |
| Read-only network smoke | Ethereum 1, Base 8453, Arbitrum 42161, Syscoin NEVM 57 returned the expected chain and a balance for a public burn address via Node fetch |
| JavaScript export | Web, Android Hermes and iOS Hermes bundles export successfully |
| Native project generation | iOS and Android prebuild succeeds without installing native toolchains |
| Generated configuration | Android backup and cleartext disabled; unused storage, camera, microphone, overlay and vibration permissions marked for removal; no iOS Face ID prompt configured; OTA updates disabled |
| Package advisory snapshot | `npm audit`: zero reported vulnerabilities after the glob/minimatch overrides |

Browser network tests use synthetic public addresses and mocked responses. The separate network smoke is read-only and did not use a user's wallet. Preview QR codes encode explicit non-payment text; preview confirmations do not create a transaction. Web watch accounts are memory-only and disappear on reload. On native platforms, only validated public account configuration is written through SecureStore.

The UI has separate live and preview preferences, readable fixed network context, native-safe layouts, reduced-motion handling, scrollable sheets, modal background isolation, and a single clipboard acknowledgment. Pending balance requests are retired on lock or context changes. Account creation is single-flight; a late durable write cannot unlock the interface after backgrounding or navigation.

### Limits of that validation

That record did not include a compiled, signed or installed iOS/Android binary, or physical-device execution. Full Xcode was not installed on the validation host. Native SecureStore persistence, Android/iOS lifecycle behavior, native clipboard and sharing, accessibility services, large system fonts, keyboard behavior and performance were not established by those checks. Generated manifest checks were not a review of a merged release manifest or compiled binary.

At that snapshot, seed creation/import, private-key custody, PIN authentication, biometric unlock, live signing/broadcast, UTXO watch backend, dapp connection, hardware wallet, passkey, private-note and proving integration were not implemented. The current source status above supersedes that implementation inventory; the historical checks do not validate the later capabilities.

Metro reported a dependency export warning for `@noble/hashes/crypto.js` while resolving ethers. Exports and the tested public-address code worked, but those results did not establish native runtime compatibility or cryptographic readiness.

See [SECURITY.md](SECURITY.md) for the custody and transaction release gates and [README.md](README.md) to run the build.

## Full-wallet design review

**Historical record.** Checked November 2, 2026 against the same extension baseline. The full-wallet explorer contains 182 selectable views and 40 additional operation-specific authorization/result models. All 46 capability groups in [the parity matrix](design/PARITY_MATRIX.md) have explicit design mappings. Counts establish navigation coverage, not feature implementation or protocol equivalence.

- Strict TypeScript check and web production export pass.
- All 24 unit tests pass, including six design tests for complete navigation targets, source capability mapping, operation-specific authorization, inert secret samples and consistent backup inventory.
- All 16 browser tests pass: seven foundation checks and nine design checks, including Ethereum/PSBT identity, account-change re-review, watch-only restrictions, three responsive sizes, local versus hardware authorization, and password-confirmed note-package restoration with verification pending.
- Representative screens were visually inspected in Chromium and the in-app browser. The review used a local preview at `http://127.0.0.1:4177/`; this record does not establish that the server is still running.
- Independent source/design review corrected the guardian/composite distinction, pinned Ethereum privacy scope, individual-note backup behavior, per-operation results, restored-note verification and backup handoff versus read-back verification.

The draft PR integration also adds a package-local Expo lint configuration and a dedicated CI workflow. Extension lint and unit-test discovery exclude the mobile package because its own lint, Node tests and browser tests run separately. The extension's 736-suite `test:unit` selection is unchanged. Mobile screens derive their visible route from the current watch-authority state, and modal dismissal content is retained in state rather than mutating refs during render. Design Back closes panels, follows local design history, then exits; the shared Escape path is browser-tested while native Back delivery remains a device check.

The encrypted whole-note-vault package is a proposed shared enhancement, described in [NOTE_BUNDLE_BACKUP.md](design/NOTE_BUNDLE_BACKUP.md). These checks do not test a real backup codec, import transaction, password KDF, signing service or native custody. Design controls use inert samples and make no live wallet calls.
