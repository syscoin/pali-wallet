# Pali Mobile

A React Native / Expo SDK 58 mobile app in the extension repository. The reviewed development implementation supports wallet creation/restoration, password unlock, seed backup, HD and imported EVM accounts, selected EVM transfers, and public-address watching. Watch-only accounts and the interactive design preview remain separate from custody. **Full extension feature equivalence remains incomplete. Implemented code, offline native qualification, live-network execution and physical-device release qualification are separate milestones. This is not a shipping self-custody wallet.**

The implementation starts from extension source `4470e54e8777cca2a4fe7c712409f60eeb4fa401`. The handoff's reference checkout at `88cc9c9a8959b5dccc7ff43f136d60203782918a` adds documentation changes. The supplied screen deck and video are product references, not evidence of native security or working transaction support.

The [capability ledger](design/PARITY_MATRIX.md#current-implementation-ledger) records the current source basis, exact implemented scope, remaining work and qualification boundaries. Its reviewed source is `c37592ea37a70d5feecd56acda40291f913a2fc5`, the unmerged [public UTXO watch PR #1181](https://github.com/syscoin/pali-wallet/pull/1181), stacked on [native HTTP qualification PR #1180](https://github.com/syscoin/pali-wallet/pull/1180). These references identify a development candidate, not a release.

## Full-wallet design target

The full extension-equivalent mobile product is now specified in the [design review](design/README.md). Choose **Review full wallet design** on the welcome screen for the interactive catalogue. Its simulated screens do not change operational wallet capabilities. The shared whole-note-vault backup/restore package and extension file flows are implemented in the foundation work; their mobile screens still need to be connected to native storage and file access.

### Manual ERC20 portfolio

The native Wallet screen supports manually entering an ERC20 contract on the selected registered EVM network, reviewing its untrusted name/symbol, full contract, precision and balance, and confirming a local list entry. Token details provide exact balances, a selected-token refresh, the existing network-bound Receive flow, and removal from the local list. Removal does not move tokens. Ethereum token details also open a password-confirmed ERC20 transfer review with the complete contract and recipient, exact token amount and a separate maximum ETH fee. Other networks remain balance/receive only. Third-party discovery, market prices, remote token images, NFTs and Syscoin assets remain outside this implementation slice.

Descriptors persist in one wallet-bound document, scoped to the EVM account/address and exact chain registration. Account retirement preserves entries for restoration. A document may contain at most 256 entries and must also fit the existing 64 KiB storage value limit; reaching either limit refuses the entire addition. Unknown or corrupt storage is never presented as an empty list. Balances are observations, begin unknown after restart, and are not stored as spend authority. The list refresh has two workers and a 15-second deadline: unattempted entries stay unknown and each detail can refresh its own token independently.

Codec/RPC, controller, real SQLite and actual React Native component browser tests cover this flow. Browser component tests are not physical-device, native-networking or release qualification; W02 remains partially implemented.

ERC20 sends use the same account/chain transaction journal as native ETH. The
reviewed intent is saved alongside the signed bytes before broadcast, retained
across restart and compared before an exact-byte retry. Token precision cannot
silently change during review. Token balance and ETH gas funding are checked
separately, including the original approved fee limit. Preflight accepts an
explicit true return or an empty return from a non-reverting transfer simulation;
false or malformed returns are rejected. A successful finalized receipt proves
transaction execution, not the behavior of an arbitrary token contract: fees,
rebasing and other token rules may change the received amount. Native testnet and
physical-device send qualification remain required before release.

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

Ethereum HD and imported EVM accounts have an Activity entry with direct ETH transactions and ERC20 transfer events. The list combines the current recovery journal with a bounded local archive and indexed transaction discovery. RPC reads corroborate transaction status and exact ERC20 receipt-log identities; explorer rows alone never establish execution success. Incoming and unknown token identities remain untrusted, zero-value token activity is hidden by default, and copying a history address requires reviewing its full value. Other networks and watch-only activity are not implemented.

Activity retains up to 48 local terminal summaries, 24 indexed candidates and 20 list preferences in one wallet-bound document capped at 60 KiB. Byte limits may retain fewer records; pruning is disclosed. This is recent cached history, not a complete account index, and does not include internal ETH transfers. Older history needs the configured explorer. A previous terminal journal entry is archived and read back before a later transfer can replace it, and before account removal can delete it. Archive failure preserves recovery data and prevents the new broadcast. History never supplies spend authority or changes the selected network's signing capability.

`npm run test:activity-ui` builds and exercises the actual Activity component in an isolated browser fixture on loopback port 4181. It does not qualify native network transport or physical-device behavior.

- Watch-only mode can add a public EVM address and observe Ethereum, Syscoin NEVM, Base, Arbitrum, Rollux and the labelled Syscoin NEVM/zkTanenbaum testnets. New accounts include all seven registrations; existing records retain their saved address mappings and only offer those networks. It holds no signing key. Public account configuration uses the platform protected-storage adapter, not browser storage. A storage/read failure must not be treated as a new empty account.
- The public UTXO candidate adds one explicitly reviewed P2WPKH address on fixed Syscoin or Bitcoin mainnet. It checks the configured indexer's network/genesis before sending the address and displays confirmed balance separately from signed pending change. Receive, QR, copy/share and account management are present. Other receive/change addresses, extended keys/descriptors, UTXO signing and assets are not included. Actual native HTTP qualification remains pending for this candidate.
- The interactive preview demonstrates portfolio, asset/activity, send review, receive and settings layouts with sample data. It has no transaction authority. Preview information must remain separate from saved public accounts.
- The native custody flow uses the pinned shared software keyring, an encrypted transactional SQLCipher store, and native cryptographic primitives. It supports a new 12-word wallet or an existing 12/24-word phrase, password unlock, and a wallet-bound seed-backup check. HD accounts support create/select/rename/eligible removal/restore; imported EVM keys support import/select/rename/eligible removal and need a separate key backup. The durable catalogue admits 20 active accounts across both kinds with independent indices 0–4095. HD indices are monotonic and explicitly restorable; imported ordinals are not reused. Both kinds can show balances and receive QR/copy/share on seven fixed EVM registrations. This is not an extension data migration path.
- Native custody begins only after crypto known-answer checks and private storage initialization. Missing keys, corrupt data and ambiguous writes fail closed; reopening never silently resets a wallet.
- Native-coin sends are enabled in source for Ethereum, fixed Syscoin NEVM Testnet (chain 5700) and fixed zkTanenbaum Testnet (chain 57057); ERC20 sends remain Ethereum-only. Reviews bind exact amounts, nonce, recipient and fee limits. The SDK signs the approved envelope; SQLCipher stores its intent and signed bytes before submission. Lost responses retain the same hash/bytes, and retries require fresh password confirmation. Each account/chain admits one unresolved transfer; switching contexts preserves its journal. Ethereum uses its finalized-block policy, NEVM testnet uses a labelled 12-confirmation depth observation, and zkSYS testnet uses a separate finalized-execution policy. These are distinct policies, not interchangeable guarantees of protocol finality. Live execution remains to be qualified.
- Removing an account requires no unresolved transaction and archives applicable terminal public summaries before atomic journal cleanup. Multi-pending transfers, replacements and other signing networks remain separate work. Security & backups can reveal the selected HD/imported EVM private key after fresh authentication, but cannot reset the password or remove the wallet. Imported keys are not restored by the recovery phrase.
- Biometrics, WalletConnect/dapp approvals, native hardware transport, NFTs, Syscoin assets, smart accounts, Sentry and private-note operations remain unavailable. The shared note-backup codec and extension file flow exist, but mobile note storage/file integration is missing. The broader Tools/Settings tab structure is still a design target.
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
