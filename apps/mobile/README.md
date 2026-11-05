# Pali Mobile

A React Native / Expo SDK 58 mobile app in the extension repository. The reviewed development implementation supports wallet creation/restoration, password unlock and matching-phrase password recovery, seed backup, HD and imported EVM accounts, native-coin/ERC20 transfers on saved EVM registrations, and public-address/UTXO-account watching. Watch-only accounts and the interactive design preview remain separate from custody. **Full extension feature equivalence remains incomplete. Implemented code, offline native qualification, live-network execution and physical-device release qualification are separate milestones. This is not a shipping self-custody wallet.**

The implementation starts from extension source `4470e54e8777cca2a4fe7c712409f60eeb4fa401`. The handoff's reference checkout at `88cc9c9a8959b5dccc7ff43f136d60203782918a` adds documentation changes. The supplied screen deck and video are product references, not evidence of native security or working transaction support.

The [capability ledger](design/PARITY_MATRIX.md#current-implementation-ledger) records the implemented scope and remaining gates. This description is reconciled against source `03928b18f6ec6b6d40d7eb300e6e8fd0f5acc9c8`. The [shared-core audit](docs/shared-core-audit.md) records actual host boundaries. Historical test results below remain tied to their tested revisions; they do not qualify this composed source.

## Full-wallet design target

The full extension-equivalent mobile product is now specified in the [design review](design/README.md). Choose **Review full wallet design** on the welcome screen for the interactive catalogue. Its simulated screens do not change operational wallet capabilities. The shared whole-note-vault backup/restore package and extension file flows are implemented in the foundation work; the native protected note domain and preserving-recovery path exist, but mobile note-management screens and file backup/restore are not connected.

### Manual ERC20 portfolio

The native Wallet screen supports manually entering an ERC20 contract on the selected registered EVM network, reviewing its untrusted name/symbol, full contract, precision and balance, and confirming a local list entry. Token details provide exact balances, a selected-token refresh, the existing network-bound Receive flow, and removal from the local list. Removal does not move tokens. Token details also open an ERC20 transfer review on the selected registered EVM network with the complete contract and recipient, exact token amount and a separate maximum network fee. Third-party discovery, market prices, remote token images, NFTs and Syscoin assets remain outside this implementation slice.

Token descriptors persist in one wallet-bound document, scoped to the typed account identity, address and chain. Changing a registration's RPC or display name does not discard that list. Public metadata can outlive account removal; reimport does not promise restoration under a different typed identity. The document permits at most 256 entries within its 64 KiB limit and refuses an oversized addition. Unknown or corrupt storage is not presented as an empty list. Balances begin unknown after restart and never supply spend authority. Refresh uses two workers and a 15-second deadline; unattempted entries stay unknown and details can refresh independently.

Codec/RPC, controller, real SQLite and actual React Native component browser tests cover this flow. Browser component tests are not physical-device, native-networking or release qualification; W02 remains partially implemented.

ERC20 sends use the same shared retained-signed-record policy as native-coin sends. The
reviewed intent is saved alongside the signed bytes before broadcast, retained
across restart and compared before an exact-byte retry. Token precision cannot
silently change during review. Token balance and native-currency gas funding are checked
separately, including the original approved fee limit. Preflight accepts an
explicit true return or an empty return from a non-reverting transfer simulation;
false or malformed returns are rejected. A successful canonical receipt reports
transaction execution, not the behavior of an arbitrary token contract: fees,
rebasing and other token rules may change the received amount. Native testnet and
physical-device send qualification remain required before release.

### Account-wide UTXO watch activity

Opening Activity for the active Bitcoin or Syscoin watch account loads indexed history through the same shared Blockbook account reader used by the extension. Saved public extended keys and descriptors query the whole account; address records query only that address. The authority keeps the canonical identifier private and exposes public transaction rows. No signing or scanner is added. Pending rows and nullable block observations remain visible.

Pages contain at most20 rows. The list keeps a window of at most100 rows, with older/newer navigation that can request pages beyond five. Fresh same-transaction observations replace retained status, including a return to pending; other retained rows are not proof of complete indexing. Network or storage failure preserves the previous list as stale. Backgrounding, focus loss, lock, account/network changes and leaving Activity abort its requests. Entering an active current Activity view loads again without an extra consent step.

Native account change, whole-transaction fee and transfer intent use the existing shared exact-amount helpers. Unknown ownership or missing data stays unavailable. SPT quantity is explicitly unavailable and is never inferred from rounded token metadata; native funding remains separately labelled. Source/browser tests do not qualify deployed services, native HTTP, physical privacy or complete feature equivalence. See [the implementation contract](docs/utxo-watch-activity.md).

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

## Foreground auto-lock

The development candidate adds Settings → Auto-lock for native wallets and watch accounts, with separate device-local values. The default is five minutes; choose Off or 5–120 whole minutes. Off never disables background/inactive or Android focus-loss locking. Increasing a native timeout or selecting Off requires fresh password authentication. Reads, asynchronous completions and background work do not extend the deadline.

The setting uses dedicated protected storage, outside wallet records. Failed reads retain saved bytes and offer Retry; no native memory fallback or destructive reset is provided. A permanently malformed preference record has no qualified repair flow yet. See [idle-lock behavior and qualification limits](docs/idle-lock.md).

## Current behavior

Native and watch sessions share operational **Wallet / Activity / Tools / Settings** tabs using their existing controllers. Wallet retains each account's supported balance, receive and send flows; Activity is available for native EVM accounts on their selected saved registration and for confirmed transactions at the selected watched SYS/BTC address. Tools opens account management and, for native accounts, network selection. Settings opens native Security & backups, lock/hide and development-build information. Only the active public tab is mounted. Authentication, seed/key presentation and approvals use dedicated screens without tabs; stale navigation cannot restore a previous account or session. The separate design explorer continues to use inert sample data.

HD and imported EVM accounts have Activity for direct native-coin transactions and ERC20 events. Explorer URL construction, account filtering and transaction normalization reuse shared extension modules; native adapters own bounded fetches, storage and rendering. The list combines all retained local signed records with a bounded public cache and configured explorer discovery. RPC reads corroborate status and exact ERC20 receipt-log identities; explorer rows alone do not establish execution success. Incoming and unknown tokens remain untrusted, zero-value token activity is hidden by default, and copying a history address requires reviewing its full value. A custom registration without an available explorer still has local retained history. EVM watch history and account-wide or pending/replaced UTXO history remain unimplemented.

Activity retains up to 48 local terminal summaries, 24 indexed candidates and 20 list preferences in one wallet-bound document capped at 60 KiB. Byte limits may retain fewer records; pruning is disclosed. This is recent cached history, not a complete account index, and does not include internal ETH transfers. Older history needs the configured explorer. Signed recovery records are retained independently by the common extension/native policy. New transactions, account removal and public history pruning do not discard predecessor bytes; bounded storage refuses new admission when full. History never supplies spend authority or changes the selected network's signing capability.

`npm run test:activity-ui` builds and exercises the actual Activity component in an isolated browser fixture on loopback port 4181. It does not qualify native network transport or physical-device behavior.

- Watch-only mode accepts public EVM addresses on the built-in shared registrations. It holds no signing key and stores public configuration through the platform protected-storage adapter. The current watch record limit is 20 accounts within 32 KiB; this is separate from native custody's account-map budget. Read failures never create an empty account list.
- SYS/BTC public watching accepts a supported address or public extended key/descriptor. The existing extension public-input validator and SDK derivation normalize the identifier, and SyscoinJS performs the Blockbook account query. Account balance therefore uses the backend's existing receive/change discovery rather than a new mobile scanner. Receive shows the initial projected address; current Activity remains address-scoped. These fixed mainnet providers do not enable UTXO custody or asset transfers.
- The interactive preview demonstrates layouts with inert sample data and has no transaction authority.
- Native custody uses the pinned shared software keyring, SQLCipher and native cryptographic primitives. A new 12-word wallet or an existing 12/24-word phrase can create the wallet. One canonical private document preserves the complete SDK account maps and imported-key recovery copies. Ordinary unlock restores those records; it does not rederive/reimport every account. Add account calls the same SDK allocation used by the extension, including reuse of a deleted HD gap. There is no separate native 20-account/4095-index policy or Restore-deleted-account flow. The account document is bounded to 4 MiB; IDs must satisfy the existing safe-integer contract. Account lists are virtualized. Native signing currently exposes HD and imported EVM accounts, not the other retained SDK account classes.
- Custody begins only after crypto checks and private storage initialization. Initial pair, authenticated root and full account records commit together. Missing keys, corrupt/unknown records and ambiguous writes fail closed; reopening never silently resets a wallet.
- Native-coin and ERC20 sends use the selected verified EVM registration, including custom RPC registrations. Reviews bind exact amounts, account, chain, endpoint, nonce, recipient and fees. Confirmation uses the current unlocked SDK session without retaining another password. Lock, background, context changes and expiry revoke it. The common extension/native signed-record policy persists reviewed intent and exact signed bytes before dispatch, scopes pending state to wallet profile/chain/sender across typed aliases, and retains every predecessor. Explicit replay uses the shared review/coordinator and resends the original bytes. Canonical receipts confirm/revert; later observations may revise status after a reorg. This is implemented source behavior, not live-network qualification.
- Account removal preserves signed records and public history. Removing the last account for a sender with unresolved transactions is refused; retaining another typed alias does not create independent nonce ownership. New admission refuses a full signed-record store rather than evicting recoverable bytes. Native replacement/cancellation initiation and multiple-pending-send UX remain unfinished.
- Security & backups can reveal a selected HD/imported EVM private key after fresh authentication. Matching-phrase password recovery rewraps complete supported SDK records and preserves their metadata, imported recovery copies, recognized note ciphertext and signed records. An imported key is recoverable only while its seed-profile-encrypted copy or a separate backup exists; a phrase cannot recreate a missing independent key. Whole-wallet removal remains unimplemented on mobile.
- Biometrics, dapp sessions/approvals, native hardware transport, NFTs, Syscoin assets, smart-account operations, Sentry and private-note operations remain unavailable. Shared preservation/storage support does not make their operational screens available. Full language/currency/support settings and other advanced Tools capabilities remain unfinished.
- Watch-only remains an account type in the intended combined account selector, and an independent onboarding option. Optional native transaction alerts still need delivery, enrollment and privacy controls; balance polling alone is not a notification service.
- RPC services can observe queried addresses and network metadata. A public address is not a secret, but the association between addresses, devices and users can be private. See [SECURITY.md](SECURITY.md).

## Matching-phrase password recovery

The native development flow starts at **Forgot password?** on the locked screen. It reads a sanitized inventory through the original storage owner, verifies the matching 12/24-word phrase, reviews preservation, and atomically changes the device password through the shared SDK-backed recovery coordinator. It drains the old owner and any prepared recovery before installing a fresh locked wallet; unlocking is always explicit. Cancellation during commit can leave the new password durable, so uncertain outcomes retain that guidance rather than claiming rollback. No phrase/password draft or proof is stored, copied or shared by the UI.

Complete supported SDK account records are rewrapped under the new password. Imported-key recovery copies, tokens, transaction records and recognized existing private-note ciphertext are preserved; notes are authenticated during recovery even though mobile note operations are not implemented. A phrase without the retained imported-key copy or note data cannot recreate those independent secrets on a lost device. Unknown/corrupt records refuse recovery. Browser/Node checks do not qualify native privacy, keyboards, process interruption or device behavior.

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

At this source basis, lockfiles pin official `@sidhujag/sysweb3-keyring` 2.1.2,
`@sidhujag/sysweb3-network` 1.0.111 and `syscoinjs-lib` 1.0.277 archives with
integrity hashes. The latter defers legacy
Ethereum-proof imports until an explicit proof operation; ordinary wallet
initialization does not load that dependency tree.

Native startup uses QuickCrypto's own scheduler without adding `process.browser`
or a synthetic Node version. Crypto, Buffer and stream adapters remain required
by the native SDK graph. Unsupported Node transports still fail closed; delaying
proof initialization does not make those transports available on mobile.
