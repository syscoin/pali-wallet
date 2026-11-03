# Pali Mobile

A React Native / Expo SDK 58 mobile foundation in the extension repository. It provides a native watch-only account experience and a separate interactive design preview. **This is not a shipping self-custody wallet, and it cannot create a wallet, import a recovery phrase, sign, or send funds.**

The implementation starts from extension source `4470e54e8777cca2a4fe7c712409f60eeb4fa401`. The handoff's reference checkout at `88cc9c9a8959b5dccc7ff43f136d60203782918a` adds documentation changes. The supplied screen deck and video are product references, not evidence of native security or working transaction support.

## Full-wallet design target

The full extension-equivalent mobile product is now specified in the [design review](design/README.md). Choose **Review full wallet design** on the welcome screen for the interactive catalogue. Its simulated screens do not change the live watch-only capabilities. The whole-note-vault backup/restore package is explicitly tracked as a proposed shared enhancement, not an existing extension feature.

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

The commands disable Expo CLI telemetry. Over-the-air updates are disabled in app configuration. These settings do not replace review of release builds or third-party dependency behavior.

## Current behavior

- Native mode can add a public EVM address and observe supported network balances. It is explicitly watch-only; it holds no signing key. Public account configuration uses the platform protected-storage adapter, not browser storage. A storage/read failure must not be treated as a new empty account.
- The interactive preview demonstrates portfolio, asset/activity, send review, receive and settings layouts with sample data. It has no transaction authority. Preview information must remain separate from saved public accounts.
- Recovery phrases and PINs are not accepted. Device-wallet creation, seed import, signing, WalletConnect, hardware wallets, smart accounts and private-note operations are unavailable.
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

The dedicated mobile CI workflow uses this package's lockfile and runs these checks plus Android/iOS JavaScript exports. It does not compile, sign or publish a native application.

Product quality includes safe-area layout, keyboard avoidance, accessible touch targets and labels, text scaling, reduced motion, predictable back navigation, and honest loading/error states. Sample balances, mock receipts and preview acknowledgments must never appear as live account facts.

The mobile lockfile overrides `glob` to 14.0.3 and `minimatch` to 11.0.4 for the upstream cancellation/amplification advisories. These affect build tooling; keep the overrides under review when upgrading Expo.
