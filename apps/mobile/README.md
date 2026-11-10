# Pali Mobile

Pali Mobile is a React Native / Expo SDK 58 application in the extension repository. Full extension feature equivalence and release qualification remain in progress. Use disposable test wallets while those gates are open.

This implementation summary is reconciled against master `2738be3b2d8043e4b76e825ed0145d1a8a33fc9a`. The [design review](design/README.md), supplied screen deck and demo video guide the product. The [parity matrix](design/PARITY_MATRIX.md) preserves the feature inventory and acceptance criteria. Its historical implementation ledger has its own recorded source basis.

## Implemented application flows

Native custody and public watch accounts use **Wallet / Activity / Tools / Settings**. Only the active public tab stays mounted. Authentication, backup and transaction approvals use dedicated screens. The separate design explorer uses inert sample data.

| Area                      | Current development implementation                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet and accounts       | Create a 12-word wallet or restore a matching 12/24-word phrase, password unlock, backup challenge, HD account creation, selection, rename and eligible removal. Import EVM private keys, UTXO WIF keys and BIP84 account private keys. Supported private-key formats can be revealed after fresh password confirmation.                                              |
| View-only accounts        | Watch public EVM addresses and supported UTXO addresses, extended public keys or descriptors. UTXO account discovery and history use the extension's shared SDK and Blockbook reader.                                                                                                                                                                                 |
| Networks                  | Select shared built-in registrations and add, edit or remove eligible custom EVM and UTXO registrations. UTXO custody requires a network and signing rule supported by the shared software engine. Endpoint identity and retained-transfer checks protect registration changes.                                                                                       |
| EVM assets and transfers  | Native coin, ERC20 and supported ERC721/ERC1155 transfers, exact amounts, manual token/collectible import, explicit explorer-backed discovery, ownership checks and local list removal. Automatic nonce selection and an advanced override share the extension's policy. Saved pending transactions expose eligible Cancel and Speed Up actions and exact-byte retry. |
| UTXO assets and transfers | Native-coin sends for supported software accounts and registrations, including maximum amount. Syscoin UTXO exposes exact SYSX holdings and allocation sends with separate native funding and change. Saved transfers support reviewed retry through their original verified route.                                                                                   |
| Hardware wallets | Ledger BLE import, wallet signing and connected Smart-account owners use the shared SDK and existing picker. Smart-owner readiness verifies every planned key on the connected device while preserving the selected Smart account; multiple physical-device handoff remains unsupported. Trezor import and EVM/UTXO wallet sends use official Suite app links, the same shared signers, and fresh review after returning from background lock. Saved signed-byte retry remains device-free. Trezor message and transaction requests use the same bounded Suite handoff as PSBT: return requires a new unlock, the original live request and expiry, a fresh review and separate Confirm. Requests with unproven freshness are refused. A single Trezor Smart-account owner uses the same shared signing plan and bounded continuation for dapp requests and local wallet, guardian-policy, authenticator and SLH installation operations. Return requires a new unlock, fresh review and separate signing/payer consent; accepted signatures cannot resume. Multiple Trezor owners and actual model/OS qualification remain open. |
| Activity                  | Shared EVM explorer, filtering and normalization for custody and watch accounts. Seeded and watch UTXO accounts use shared indexed history and bounded transaction details. The view combines public observations with retained local submissions.                                                                                                                    |
| Security and recovery     | Foreground idle lock, lifecycle lock, authentication throttling, seed/key reveal, matching-phrase password recovery, and authenticated removal of the wallet from this device. Recovery preserves supported account records, imported-key recovery copies, private notes and signed records.                                                                          |
| Private notes             | List locally saved notes, inspect details, reveal an individual note after fresh authentication, adjust the shared capacity policy, and export or restore the encrypted whole-note bundle through native file adapters. Software HD/imported accounts can review and submit Classic ETH deposits through the shared fee, nonce and signed-record path. Explicit note-status checks use the owned pool verifier; withdrawals and native/device qualification remain pending.                                                                                                |
| Tools and preferences     | Account/network management, local trusted-site lookup, guardian status and policy management, threshold-1 ECDSA recovery for saved Smart accounts, Display currency, Help & about, and an explicit external testnet-faucet link where available.                                                                                                                                                                              |

### Asset observations and history

Imported metadata, explorer suggestions, balances and NFT ownership are untrusted observations. Suggestions feed the same RPC review and explicit save flow as manual entry. Transfer review binds the complete recipient, contract or asset identifier, raw amount, account, network, nonce and maximum fee. The shared final checks run again before dispatch.

Known queued asset debits are reserved once per nonce group. Exact-call simulation checks the reviewed transfer against the selected state. Token-specific fees, rebasing and other contract rules can affect the received amount even after successful execution.

Native funding uses shared canonical and pending balance bounds. Ordinary single-variant pending groups keep the node’s pending-balance semantics. Competing retained variants add a conservative maximum-cost reserve, which can reduce the available amount until that ambiguity clears. Manual nonce selection changes execution estimation independently of funding, so unrelated pending debits remain included. Queueing remains available when pending credits are conditional, so a later transaction can wait or fail if a replacement removes an expected credit.

Ordinary Activity rows use indexed facts without per-row RPC enrichment. Retained unconfirmed EVM submissions use the shared observer, and opening a detail can request additional facts. A canonical receipt supplies the confirmation or revert observation. Later observations can reflect a reorganization. EVM internal transfers, full collectible enumeration and complete historical indexing remain open scope.

UTXO Activity requests at most 20 rows per page and keeps a 100-row navigation window. EVM recent-history storage keeps up to 48 local terminal summaries, 24 indexed candidates and 20 list preferences within 60 KiB. Byte limits can reduce those counts. Older history remains available through a configured explorer.

Guardian recovery uses an existing verified Smart account with local HD/imported guardian and replacement keys. The first flow supports threshold 1 and uses the guardian as fee payer. It saves public recovery intent before signing, resumes after interruption, and atomically adopts recovered metadata before releasing intent references. Pure watch accounts provide read-only status. Separate fee payers, higher thresholds, other authenticators and physical-device qualification remain open.

### Signed transaction recovery

The extension and mobile use the same retained signed-record policy. Exact signed bytes and reviewed intent are saved before broadcast. Replay, replacement and ordinary new sends have distinct admission checks, with ownership scoped to the wallet profile, chain and sender across account aliases.

The EVM journal has limits of 4,096 records and 16 MiB. At a genuine capacity refusal, bounded maintenance checks available configured routes and retires completed nonce groups after fresh hash-specific receipt and finalized-block observations, then retries saving the same signed bytes once. These observations rely on the configured RPC. Maintenance keeps every group with an unresolved signed, attempted or submitted record, and never installs a permanent nonce floor. Insufficient reclaimable space refuses the new submission. The explicit Clear activity and nonce data action discards selected-account/network local tracking and refreshes through the same RPC. It does not cancel transactions the network may still hold. Account removal and public-history pruning preserve recovery records.

### Recovery and device storage

Native custody starts after cryptographic checks and protected-storage initialization. The shared software keyring, SQLCipher and native cryptographic primitives preserve complete SDK account maps. Ordinary unlock restores those maps. Add account uses the same SDK allocation as the extension, including reuse of an available HD account slot.

The account document has a 4 MiB budget. Public watch records separately allow 20 accounts within 32 KiB. The local asset registry has a 256-entry, 64 KiB budget. Missing, corrupt or ambiguous storage fails closed and offers the applicable recovery or retry flow.

**Forgot password?** verifies the matching phrase, reviews preservation and uses shared recovery staging code to rewrap supported saved data. Imported keys require their retained encrypted recovery copy or an independent backup. A phrase alone cannot recreate missing independently imported keys or missing private notes on a lost device. A commit interrupted by cancellation can leave the new password durable, so the UI retains recovery guidance for an uncertain result.

Settings → Auto-lock stores a device-local preference for custody and watch sessions. The default is five minutes, with Off or 5–120 whole minutes available. Increasing the custody timeout or choosing Off requires fresh password authentication. Background/inactive transitions and Android focus loss still lock the session. Asynchronous work does not extend the deadline. Repair of a permanently malformed idle-lock preference remains open scope.

## Remaining implementation and qualification

Saved-note direct and relayed withdrawal adapters and review UI are implemented as a qualification candidate. They reuse the shared proof, fixed-gas transaction and note-reservation paths. Native proof/resource qualification and production pool qualification remain required before release. Failed-withdrawal recovery and completed-note cleanup remain separate work.

Remaining dapp methods, hardware model/transport qualification and hardware dapp signing, additional smart-account authenticators, broader guardian recovery, privacy-pool qualification and Sentry operational/vote signing remain outstanding. Tools → Sentry now groups authority keys and linked nodes; shared link/release and collateral protections are implemented, with native-device and funded-network qualification still open. Native biometric qualification, remaining passkey support, system watch-notification enrollment/delivery, localization and several advanced transaction tools also remain open. Shared primitives and native test fixtures for these areas have their own implementation and qualification status.

The [shared-core audit](docs/shared-core-audit.md), [security requirements](SECURITY.md) and [native qualification contract](qualification/README.md) describe the host boundaries and release gates. Track live-network, physical-device and full user-journey acceptance separately from source implementation.

## Run

Use Node **26.12.1**, as pinned in the repository's `.nvmrc`. The mobile package owns its npm lockfile. The extension uses the root Yarn dependency graph.

```sh
cd apps/mobile
npm ci
npm run web
```

`web` opens the design-validation surface. Recovery-phrase intake and the native keyring belong to the native application. Install the appropriate platform toolchain before running a native development build.

```sh
npm run ios       # macOS, full Xcode and iOS build dependencies
npm run android   # Android SDK, Java and an emulator or device
```

The `preios` and `preandroid` hooks download the pinned public proving key and run the shared proof-asset packager before the native build. Install the root Yarn dependencies as well as the mobile npm dependencies. The packager verifies asset hashes and removes its temporary key directory. A failed download or pin check stops the build. No proving key is downloaded during wallet operation.

Native onboarding offers wallet creation, phrase restoration and watch-only accounts directly. Custody requires the native runtime checks. The package scripts disable Expo CLI telemetry. Over-the-air application updates are disabled in app configuration.

### Connected apps configuration

The native build uses Pali Mobile's public [WalletConnect project ID](https://dashboard.walletconnect.com/). Set `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` at build time to select another project. This public client identifier is separate from the Chrome Web Store extension ID.

The native connection implementation supports pasted links, QR and deep-link entry, explicit account/network consent, saved sessions, revocation, public reads, and software-account message and transaction reviews through shared policy. Locally controlled ECDSA Smart accounts support personal-sign and V4 typed-data review through the same ERC-7739 digest and signature-envelope preparation as the extension. The native flow uses local HD/imported owners, verified Ledger owners and a single verified Trezor owner after a fresh validator read, with the same ordered signing plan used by the extension. Trezor personal/V4 typed messages and transactions use owned shared SDK signing and the common PSBT/EVM Suite continuation policy. Background return preserves public correlation only; it does not restore approval or a private signing context. Accepted signatures and uncertain submissions cannot resume as unsigned requests. Other Smart authenticators and native/device signing qualification remain open. Remaining dapp methods and native transport qualification are tracked in the parity matrix. Transport credentials use the existing protected database, and recovery preserves the connection record. Removing an account atomically retires its grants while preserving unrelated connections.

## Shared code and dependencies

Metro resolves selected platform-independent modules directly from `source/`. Both hosts reuse SDK derivation/signing and shared network identity, exact amounts, fee review, asset checks, nonce planning, signed recovery, history and note-backup code. Native adapters provide rendering, protected storage, HTTP, file access and lifecycle handling.

`src/core/` exposes bounded public account/network data and narrow authority interfaces. Keep secret-bearing extension state behind the appropriate host boundary. Browser runtime messaging, Redux singletons and hardware transports require their own host adapters.

The [mobile lockfile](package-lock.json) pins the official npm releases below with integrity hashes.

| Dependency                   | Version |
| ---------------------------- | ------- |
| `@sidhujag/sysweb3-keyring`  | 2.1.9   |
| `@sidhujag/sysweb3-network`  | 2.0.0   |
| `syscoinjs-lib`              | 2.0.0   |
| `syscointx-js`               | 2.0.0   |
| `react-native-quick-crypto`  | 1.1.9   |
| `react-native-nitro-modules` | 0.37.2  |

Both hosts pin official Keyring 2.1.11 from Sysweb3 #107 for mandatory owned hardware-message signing and Trezor envelope validation. The registry tarball matches all 322 reviewed package files byte for byte; the temporary archive and its qualification-only support have been removed. Qualification records bind the exact installed version and lockfile hash; the [shared-core audit](docs/shared-core-audit.md) tracks completion.

QuickCrypto uses its native scheduler. Crypto, Buffer and stream adapters support the native dependency graph. Unsupported Node transports fail closed. The lockfile also pins the reviewed tooling overrides, including `glob` 14.0.3 and `minimatch` 11.0.4.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build:web
npx playwright install chromium
npm run test:ui
npm run test:activity-ui
```

The mobile foundation workflow covers host behavior, browser component tests and JavaScript exports. `mobile-native-qualification.yml` builds isolated Android and iOS Simulator applications with native bridge and cryptographic checks. Android covers custody and process restart. The iOS Simulator contract expects protected-storage refusal and records `custodyQualified: false`. Successful physical-iPhone custody and persistence remain release gates.

At source `b64f434440a754bd3644246e0a471220499a2fed`, all 15 PR checks passed before [the integration into master](https://github.com/syscoin/pali-wallet/pull/1326). The [dedicated public-pool Release run](https://github.com/syscoin/pali-wallet/actions/runs/42389728107) passed on Android and iOS Simulator with exact-head, lockfile and artifact evidence. Its fixture covers 1,025 leaves, bounded synchronization and Merkle paths.

The same integration received bounded extension and Android QA. Extension checks used synthetic local Anvil transactions. Android functional checks used normal crypto/storage/transport with a debug signer and five QA application-identity overrides. Pixel inspection used a separate capture-enabled test variant, followed by reinstalling the protected build for functional checks. Physical iPhone, live Android transfers, complete UTXO/hardware coverage and full-inventory UI passes remain unqualified by that bounded run.

Record each subsequent test's exact source, built artifact and scope. Native release acceptance includes safe-area and keyboard behavior, accessibility, privacy, interruption/restart, supported devices and live service behavior.
