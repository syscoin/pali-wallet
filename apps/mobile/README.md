# Pali Mobile

A React Native / Expo SDK 58 mobile foundation in the extension repository. It provides native wallet setup, a watch-only account experience, and a separate interactive design preview. **This is not a shipping self-custody wallet. Native Ethereum signing and submission are implemented, but native binary and physical-device qualification remain release gates.**

The implementation starts from extension source `4470e54e8777cca2a4fe7c712409f60eeb4fa401`. The handoff's reference checkout at `88cc9c9a8959b5dccc7ff43f136d60203782918a` adds documentation changes. The supplied screen deck and video are product references, not evidence of native security or working transaction support.

## Full-wallet design target

The full extension-equivalent mobile product is now specified in the [design review](design/README.md). Choose **Review full wallet design** on the welcome screen for the interactive catalogue. Its simulated screens do not change the live watch-only capabilities. The shared whole-note-vault backup/restore package and extension file flows are implemented in the foundation work; their mobile screens still need to be connected to native storage and file access.

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

- Native mode can add a public EVM address and observe supported network balances. It is explicitly watch-only; it holds no signing key. Public account configuration uses the platform protected-storage adapter, not browser storage. A storage/read failure must not be treated as a new empty account.
- The interactive preview demonstrates portfolio, asset/activity, send review, receive and settings layouts with sample data. It has no transaction authority. Preview information must remain separate from saved public accounts.
- The native custody flow uses the pinned shared software keyring, an encrypted transactional SQLCipher store, and native cryptographic primitives. It supports a new 12-word wallet or an existing 12/24-word phrase, password unlock, and a wallet-bound seed-backup check. It currently uses the first Ethereum address for a live ETH balance, receive QR/copy/share, and password-confirmed native ETH transfers. It is not an extension data migration path.
- Native custody begins only after crypto known-answer checks and private storage initialization. Missing keys, corrupt data and ambiguous writes fail closed; reopening never silently resets a wallet.
- Ethereum transfer reviews bind exact amounts, nonce, recipient and fee limits. The shared software SDK signs the approved envelope; native SQLCipher storage journals its signed bytes before submission. Lost responses retain the same hash and signed bytes, and retries require a fresh password confirmation. This increment supports one unresolved Ethereum transfer at a time; multi-pending activity history remains a separate implementation step. Native qualification is required before using real funds.
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

## Temporary dependency staging

This branch uses integrity-pinned local sysweb3-keyring 2.0.0 and syscoinjs-lib 1.0.276 archives while npm publication is deferred. The latter defers legacy Ethereum-proof imports until an explicit proof operation; ordinary wallet initialization does not load that dependency tree. `scripts/verify-staged-keyring.cjs` checks each archive hash, version and every installed package file; CI runs it explicitly even when dependency lifecycle scripts are disabled. Replace the local lockfile source and remove this staging gate only after verifying each published archive has identical integrity.
