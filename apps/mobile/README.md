# Pali Mobile

A React Native / Expo SDK 58 mobile foundation in the extension repository. The native development flow implements wallet creation/import, password unlock, seed backup, and seed-derived Ethereum accounts with ETH portfolio, receive and send operations with an encrypted transaction journal. Watch-only accounts and an interactive design preview remain separate modes. **Full extension feature equivalence remains incomplete. An end-to-end native testnet transfer, physical-device behavior and signed release artifacts remain unqualified. This is not a shipping self-custody wallet.**

The implementation starts from extension source `4470e54e8777cca2a4fe7c712409f60eeb4fa401`. The handoff's reference checkout at `88cc9c9a8959b5dccc7ff43f136d60203782918a` adds documentation changes. The supplied screen deck and video are product references, not evidence of native security or working transaction support.

## Full-wallet design target

The full extension-equivalent mobile product is now specified in the [design review](design/README.md). Choose **Review full wallet design** on the welcome screen for the interactive catalogue. Its simulated screens do not change operational wallet capabilities. The shared whole-note-vault backup/restore package and extension file flows are implemented in the foundation work; their mobile screens still need to be connected to native storage and file access.

### Manual ERC20 portfolio

The native Wallet screen supports manually entering an ERC20 contract on the selected registered EVM network, reviewing its untrusted name/symbol, full contract, precision and balance, and confirming a local list entry. Token details provide exact balances, a selected-token refresh, the existing network-bound Receive flow, and removal from the local list. Removal does not move tokens. Token sending, third-party discovery, market prices, remote token images, NFTs and Syscoin assets remain outside this implementation slice.

Descriptors persist in one wallet-bound document, scoped to the HD account/address and exact chain registration. Account retirement preserves entries for restoration. A document may contain at most 256 entries and must also fit the existing 64 KiB storage value limit; reaching either limit refuses the entire addition. Unknown or corrupt storage is never presented as an empty list. Balances are observations, begin unknown after restart, and are not stored as spend authority. The list refresh has two workers and a 15-second deadline: unattempted entries stay unknown and each detail can refresh its own token independently.

Codec/RPC, controller, real SQLite and actual React Native component browser tests cover this flow. Browser component tests are not physical-device, native-networking or release qualification; W02 remains partially implemented.

## Run

Use Node 26 and install from this directory. The mobile package has its own lockfile; it does not replace the extension's package manager or dependency graph.

```sh
cd apps/mobile
npm ci
npm run web
```

`web` opens the design-validation surface. Native secure storage and device behavior cannot be qualified in a browser. For a local native development build, install the appropriate platform toolchain first:

```sh
npm run ios       # macOS, full Xcode and iOS build dependencies required
npm run android   # Android SDK, Java and an emulator/device required
```

Native onboarding offers wallet creation, phrase restoration, and watch-only accounts directly. No build flag or user setting enables custody. Every custody session must pass the native cryptographic and storage checks before creation or authentication. Use only test wallets until native binary and physical-device qualification is complete. The web build never accepts recovery phrases or loads the native keyring.

The commands disable Expo CLI telemetry. Over-the-air updates are disabled in app configuration. These settings do not replace review of release builds or third-party dependency behavior.

## Current behavior

- Watch-only mode can add a public EVM address and observe Ethereum, Syscoin NEVM, Base, Arbitrum, Rollux and the labelled Syscoin NEVM/zkTanenbaum testnets. New accounts include all seven registrations; existing records retain their saved address mappings and only offer those networks. It holds no signing key. Public account configuration uses the platform protected-storage adapter, not browser storage. A storage/read failure must not be treated as a new empty account.
- The interactive preview demonstrates portfolio, asset/activity, send review, receive and settings layouts with sample data. It has no transaction authority. Preview information must remain separate from saved public accounts.
- The native custody flow uses the pinned shared software keyring, an encrypted transactional SQLCipher store, and native cryptographic primitives. It supports a new 12-word wallet or an existing 12/24-word phrase, password unlock, and a wallet-bound seed-backup check. It supports creating, selecting, renaming, removing and restoring seed-derived Ethereum accounts, each with balance and receive QR/copy/share on the seven built-in EVM networks. The network picker persists its selection and makes test networks explicit. Password-confirmed native transfers remain limited to Ethereum. The durable catalogue admits 20 active accounts and derivation indices 0–4095; creation is monotonic and removed indices remain explicitly restorable. It is not an extension data migration path.
- Native custody begins only after crypto known-answer checks and private storage initialization. Missing keys, corrupt data and ambiguous writes fail closed; reopening never silently resets a wallet.
- Ethereum transfer reviews bind exact amounts, nonce, recipient and fee limits. The shared software SDK signs the approved envelope; native SQLCipher storage journals its signed bytes before submission. Lost responses retain the same hash and signed bytes, and retries require a fresh password confirmation. Each account supports one unresolved Ethereum transfer at a time; switching accounts preserves its journal. Removing an account requires no unresolved transaction; only terminal local journal history is pruned atomically. Multi-pending activity history remains a separate implementation step. Native qualification is required before using real funds.
- Biometrics, WalletConnect, hardware wallets, additional signing networks, smart accounts and private-note operations remain unavailable. The private-note backup codec is separate from this seed-backup flow.
- Watch-only remains an account type in the intended combined account selector, and an independent onboarding option. Optional native transaction alerts still need delivery, enrollment and privacy controls; balance polling alone is not a notification service.
- RPC services can observe queried addresses and network metadata. A public address is not a secret, but the association between addresses, devices and users can be private. See [SECURITY.md](SECURITY.md).

## Shared code and boundaries

The mobile app lives alongside the extension rather than importing its browser runtime. Metro can resolve narrowly selected, platform-independent modules from `source/`; those are direct source dependencies, not forked copies. Pure validation and review behavior can be shared this way before extracting a separate package.

`src/core/` defines public account/network data, exact amount handling, operation context and a narrow authority interface. Do not expose extension keyring state wholesale: some extension account models include secret-bearing fields. Do not replace this interface with arbitrary controller-method invocation, a Chrome API shim, or a general WebView bridge.

The extension's controller, Redux singleton, Chrome storage, runtime messaging, alarms, approval windows and hardware transports are not native implementations. They must be adapted deliberately. See [SECURITY.md](SECURITY.md) for the release gates.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build:web
npx playwright install chromium  # once, for browser checks
npm run test:ui
```

These checks cover the code that can run locally. A successful web export is not an iOS/Android build or a security qualification. Record native device tests and exact build revisions separately.

The existing mobile workflow runs host tests, browser tests and JavaScript exports. `mobile-native-qualification.yml` separately builds isolated iOS simulator and Android emulator applications and exercises the real bridge and production KDF. Android also checks durable wallet identity across process restart. The iOS Simulator job expects strict protected-storage refusal and produces separate limited evidence with `custodyQualified: false`; it does not qualify wallet persistence. A signed physical-iPhone build must pass custody, cold-restart and privacy checks before iOS release. See [native qualification](qualification/README.md). The public fixtures use a CI-specific entry point and application identifier. Neither workflow publishes an application.

Product quality includes safe-area layout, keyboard avoidance, accessible touch targets and labels, text scaling, reduced motion, predictable back navigation, and honest loading/error states. Sample balances, mock receipts and preview acknowledgments must never appear as live account facts.

The mobile lockfile overrides `glob` to 14.0.3 and `minimatch` to 11.0.4 for the upstream cancellation/amplification advisories. These affect build tooling; keep the overrides under review when upgrading Expo.

## Shared SDK dependencies

The lockfiles pin the npm archives for `@sidhujag/sysweb3-keyring` 2.0.0 and
`syscoinjs-lib` 1.0.276 by SHA-512 integrity. The latter defers legacy
Ethereum-proof imports until an explicit proof operation; ordinary wallet
initialization does not load that dependency tree.

Native startup uses QuickCrypto's own scheduler without adding `process.browser`
or a synthetic Node version. Crypto, Buffer and stream adapters remain required
by the native SDK graph. Unsupported Node transports still fail closed; delaying
proof initialization does not make those transports available on mobile.
