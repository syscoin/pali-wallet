# Pali mobile product design

Status: native product specification and review artifact. The current native development flow implements wallet creation and restore, password unlock and recovery, seed backup, HD and imported EVM accounts, EVM portfolio, receive and send, and public EVM and UTXO watching. The extension and mobile share signed transaction retention and replay rules. The [capability ledger](PARITY_MATRIX.md#current-implementation-ledger) records what is implemented and what still needs native, live network and release qualification.

Source baseline: `4470e54e8777cca2a4fe7c712409f60eeb4fa401`. The handoff's `88cc9c9a8959b5dccc7ff43f136d60203782918a` reference adds documentation changes. The supplied 32-screen deck and video inform visual direction and journeys; labels such as “approved” inside those artifacts do not establish approval of this specification, working native custody, or security qualification.

## Product decision

Build one Pali product with shared wallet/domain behavior and a native mobile presentation. Keep the extension's capabilities, account distinctions, exact amount handling, contextual reviews, recovery rules and localization. Adapt presentation and host services to iOS and Android. The implemented native flow is one step toward that product; watch-only remains a separate account mode.

The mobile app should feel calm and deliberate: the selected account and network are clear, amounts are readable, primary actions are reachable, and unusual consequences are explained at the decision where they matter. Preserve the Pali navy, pink and blue identity. Avoid adding exchange-style price noise, promotional panels or unrelated financial products to make the screen appear busier.

Use the deck's general hierarchy and its separate send/review/authorization stages. Improve its small type, dense rows, large unused spaces on some forms, and repeated feedback. The video is useful for navigation and screen transitions; black camera frames, visible zero balances and a copy toast do not demonstrate custody or transaction behavior.

## Navigation

Recommend four stable top-level destinations: **Wallet, Activity, Tools, Settings**. The full extension has enough operational functionality to justify Tools; burying privacy, smart accounts and Sentry under a long settings list makes them unnecessarily difficult to find. Tabs are destinations, never Send/Scan actions. Each tab retains its own navigation stack, search, filter and scroll position for the current account/network scope.

| Destination | Primary content                                                             | Secondary destinations                                                                    |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Wallet      | Account identity, network scope, balance, Send/Receive, Assets/Collectibles | Asset/NFT detail, asset import, account/network sheets, smart-account summary             |
| Activity    | Transaction history, pending work, filters and status                       | Transaction detail, batch detail, replacement status, applicable privacy operation status |
| Tools       | Privacy, Smart account, Sentry, Connected apps                              | Each feature's operational hub and its contextual setup/review screens                    |
| Settings    | Accounts, networks, security/backups, preferences, app information          | Account management, network management, advanced settings, recovery and removal           |

For larger screens, the same destinations can become a sidebar with list/detail layouts. A tablet is not a centered phone stretched into unused space. On phones, avoid a fifth “More” tab and never dynamically remove top-level tabs when changing network or account type. A tool with unmet requirements opens a useful explanation and a relevant next step.

The account selector and network selector remain distinct controls. The account label includes type when relevant: seed-derived, imported, watch-only, Ledger, Trezor or smart account. A small network label alone is insufficient when the same symbol appears on several chains.

Watch-only remains a first-class account type in this same app. Keep “Watch an address” as an onboarding option so the app can be used solely to monitor an external wallet. Inside an established wallet, add watched addresses through account management and identify them clearly in the account selector. They can display balances, activity and optional alerts, but cannot sign or spend and must never ask for the external wallet's recovery phrase. Mixing watched and signing accounts must not accidentally inherit signing capabilities or imply that a watched address is owned.

Transaction alerts are a separate, opt-in capability, not a consequence of displaying a balance or importing a key. Explain what addresses and device/push identifiers a notification service receives before enrollment, allow controls per account/network, hide amounts and addresses from lock-screen previews by default, and revoke subscriptions when a watched account is removed. A notification or deep link opens the relevant public activity context; it never unlocks or authorizes a transaction. Notification delivery, backend indexing and privacy controls remain to be implemented and qualified.

An optional “All networks” portfolio is a read-only lens. A send, receive, connection request or settings mutation resolves to one concrete account/network context before continuing. Aggregation never adds unlike asset units together. Fiat totals disclose unavailable prices or incomplete networks instead of silently presenting an incomplete total as complete.

Full-screen operational flows temporarily cover the tab bar: send/review, approvals, recovery, secret export, private-note backup, hardware confirmation and destructive actions. Ordinary asset/detail navigation keeps a predictable route back. Returning to a tab restores its context; it does not discard a draft owned by another flow.

## Source-to-mobile coverage

The extension route index is `source/routers/index.tsx`; its route families and existing behavior are the parity baseline. The labels below name conceptual screen families for product discussion, not exact explorer route IDs. The current executable design catalog and its exact IDs are in [`../src/design/catalog.ts`](../src/design/catalog.ts). Neither conceptual labels nor catalog IDs grant permission to invoke privileged operations directly from an external link.

| Conceptual screen family                                                                                | Proposed mobile destination and behavior                                                                                                                                                                                                 | Existing source reference                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome`, `create`, `import`, `restore`, `lock`                                                        | Native onboarding and unlock. Create/import establish one authoritative wallet; existing-wallet recovery is distinct from ordinary import and destructive reset. Biometric handoff follows a successfully established native credential. | `pages/Start`, `pages/CreatePass`, `pages/Import`, `pages/SeedConfirm`; `/`, `/create-password`, `/create-password-import`, `/import`, `/phrase`           |
| `wallet`, `asset`, `collectibles`, `nft`                                                                | Wallet overview, asset detail and collectible list/detail. Identify token by network plus contract/token ID or asset GUID. Native assets and imported assets have different provenance.                                                  | `pages/Home`, `pages/Home/Panel/components/Assets`, `Nfts`; `/home`, `/home/details`                                                                       |
| `asset-import`                                                                                          | Discover owned assets or enter supported identifiers. Preserve current draft and selection while changing import tabs; show unavailable ownership separately from zero ownership.                                                        | `pages/Tokens/AddToken`, `ImportToken`, `SyscoinImport`; `/tokens/add`                                                                                     |
| `receive`                                                                                               | Network/account-bound address, QR and copy/share. Hardware or smart-account address verification gets a dedicated step where supported.                                                                                                  | `pages/Receive`; `/receive`                                                                                                                                |
| `send`, `review`, `send-status`                                                                         | Recipient/asset/amount input, fee editing, complete review, explicit authorization and submission status. EVM, UTXO/SPT and NFT content remain distinct.                                                                                 | `pages/Send/SendEth`, `SendSys`, `Confirm`; `/send/eth`, `/send/sys`, `/send/confirm`                                                                      |
| `activity`, `transaction`, `batch-status`                                                               | Paginated history, filters, receipt details and progress. Preserve pending/replaced/reverted/unknown distinctions and provenance of observations.                                                                                        | `pages/Home/Panel/ActivityPanel`, `Transactions`; `pages/Send/CallsStatus`                                                                                 |
| `accounts`, `account`, `account-add`, `hardware`                                                        | Switch, rename, create/import, inspect supported identifiers, remove account, connect a physical signer. Hardware setup is an explicit native transport journey.                                                                         | `pages/Settings/ManageAccounts`, `EditAccount`, `CreateAccount`, `ImportAccount`, `ConnectHardwareWallet`                                                  |
| `networks`, `network`                                                                                   | Network list/detail, add/edit RPC, chain identity verification and connection recovery. Show family and chain ID, not just a friendly name.                                                                                              | `pages/Settings/ManageNetwork`, `CustomRPC`; `pages/SwitchNetwork`; `pages/Chain`                                                                          |
| `privacy`, `private-notes`, `private-note`, `private-deposit`, `private-withdrawal`, `privacy-settings` | Privacy hub with pool data and note vault; deposit, withdraw, note import/backup, service settings, capacity and eligible cleanup.                                                                                                       | `pages/Privacy/*`; `/privacy`                                                                                                                              |
| `smart-account`, `smart-policy`, `smart-recovery`, `smart-module`                                       | Smart-account identity/deployment, sign-in methods, installed modules, composite policy, guardian recovery, custom module and infrastructure journeys.                                                                                   | `pages/SmartAccount/*`; `pages/Settings/SmartAccountPolicy`, `SmartAccountInfrastructure`; `/home/smart-account`, `/settings/account/smart-account-policy` |
| `sentry`, `sentry-import`, `sentry-review`                                                              | Authority keys, role/type import, trusted service, protected collateral; contextual operation/link/vote requests.                                                                                                                        | `pages/Settings/SentryKeys`; `pages/Transactions/SentryOperation`, `SentryLink`, `SentryVote`; `/settings/sentry`, `/external/sentry-*`                    |
| `connections`, `connection`, `connection-request`                                                       | Connected-app/session inventory and per-account grants, separate trusted-origin search, disconnect, connect/change account/network requests.                                                                                             | `pages/Settings/ConnectedSites`, `TrustedSites`; `pages/Connections/*`; external connect/change routes                                                     |
| `request`, `sign-message`, `sign-typed-data`, `sign-psbt`, `batch-review`                               | App-owned request coordinator with a review appropriate to the requested operation. Preserve message/signature/encryption/decryption/PSBT/batch distinctions.                                                                            | `pages/Send/SendTransaction`, `SendCalls`; `pages/Transactions/SignEth`, `Sign`, `EncryptPubKey`, `Decrypt`, `EncryptionReview`; `/external/tx/*`          |
| `backup`, `phrase`, `private-key`, `security`                                                           | Recovery center, password-confirmed export, guarded reveal, automatic lock and native privacy controls. Separate backup scope by material type.                                                                                          | `pages/Settings/Phrase`, `PrivateKey`, `ForgetWallet`; `pages/Start/Start.unlockRecovery*`; relevant controller recovery behavior                          |
| `settings`, `preferences`, `advanced`, `about`, `faucet`                                                | Language/currency, advanced preferences, relevant provider transport controls, app information, and testnet-only faucet.                                                                                                                 | `pages/Settings/Languages`, `Currency`, `Advanced`, `RemoveEth`, `About`; `pages/Faucet`                                                                   |

Browser-specific parity means equivalent user control, not identical DOM terminology. For example, an extension toggle for `window.ethereum` injection becomes a mobile connection-transport setting when that transport exists. It must not imply that iOS/Android can inject into arbitrary external browser pages. The provider's enabled/disabled and disconnection consequences still require clear presentation.

## Existing behavior versus proposed additions

Full parity preserves source behavior; it does not turn plausible wallet features into claims about the extension. In this baseline, recovery-phrase import has no optional BIP39-passphrase field, and ordinary settings have no standalone password-change flow. Matched existing-wallet recovery can establish a new password through its own guarded path. Keep these distinctions in the design.

Encrypted multi-note file export, configurable multi-guardian thresholds, arbitrary executor/hook installation, editable bundler/paymaster services, and additional native hardware transports are separate proposals until implemented and qualified. They must not replace or obscure the actual baseline journeys. Hardware choices remain model/OS/firmware-specific; a generic “Bluetooth supported” label is not evidence.

## Principal journeys

### Wallet and assets

The home header contains the account selector and a separately labeled network scope. Under it, place a readable balance, a subtle privacy-visibility control, and paired Send/Receive actions. Use one prominent primary action per decision; supporting controls do not compete with the amount. Below, show assets and collectibles as appropriate to the network, then a short recent-activity section with “View all”.

Each asset row contains a trusted/local icon, name, chain label, exact formatted units and optional fiat value. Contract/GUID provenance belongs in asset detail and import review; a familiar symbol never earns a verified badge or official logo. Persist row identity when lists refresh. Show search-empty, no-assets and failed-discovery states separately. Do not expose SPT/NFT functionality on networks that do not support it simply to fill a generic tab.

Asset detail has balance and Send/Receive at the top, then relevant activity, identity and market information. A chart is secondary. Omit it when data is absent; never use a fixture chart in live mode. Show source/freshness and do not imply that a price listing verifies an asset.

### Send, fees and submission

1. Select the source account/network and asset. A preselected choice remains visibly editable before review.
2. Enter recipient, amount and relevant token/NFT quantity. Paste and scan are explicit actions. Resolve names as a separate observable step and show the resulting full address. A cancelled scan changes nothing.
3. Review source, destination, asset identity, quantity, network, maximum network fee and maximum total. Display the complete destination in a selectable, wrapping block; a shortened address alone is not adequate for confirmation. Show contract calls, token allowance and batch semantics when relevant.
4. Present native authorization with the operation context still identifiable. Biometrics confirm access to an established credential; the app does not replace a required password-confirmed secret export with a generic biometric prompt.
5. Show “Submitted”, “Confirmed”, “Rejected”, “Not sent”, “Reverted” or “Status unknown” based on evidence. A submitted transaction is not final. Unknown after a submission boundary leads to status checking, not another Send button.

Keep the draft on intentional back navigation. Account, chain, endpoint or authority-generation changes invalidate dependent resolution, fees and review. Refreshing fees visibly updates the review and requires a new deliberate confirmation when material terms change. Do not use floating-point display values as transaction inputs.

UTXO review includes inputs/outputs, change, asset GUID/quantity, fee and PSBT scope, without suggesting that every signature completes a PSBT. EVM token approval review shows spender, token identity, amount/unlimited meaning and edits where supported. EOA batch review states sequential execution and possible partial completion; smart-account atomic execution gets its own semantics and status.

### Receive

Show account, network, address and QR as one identity group. Display a concise network-specific asset warning, especially for identical symbols on different chains. QR and copy/share must use the same verified address data as the text. Copy produces one accessible confirmation only after success. The hardware verification action remains available where supported. Never use an attractive sample QR that can receive real funds.

A backup reminder can precede receiving when appropriate, but it must state the actual backup scope. Watch-only accounts need an ownership explanation, not a misleading recovery-phrase prompt. Receiving to a smart account requires the correct chain and deployment/address model; the visual must not imply that any same-looking EVM address is interchangeable.

### Activity and requests

Activity uses human labels with date groups and network/account attribution. Filters retain their state across detail navigation. A pending operation, a chain transaction and a batch receipt are distinct records, with stable IDs and links between them where supported. Missing history is not “No activity”; preserve last-known data with a freshness/error message. Show replacement and reorg states without duplicate apparent payments.

Incoming requests open through a single app-owned coordinator. The header identifies the requesting origin, requested account and network. Website logos/names are untrusted decoration. Separate account connection from transaction signing, typed-message signing, raw message signing, encryption-key disclosure and decryption. Connection approval never authorizes later requests automatically. Full typed data and raw details remain inspectable; a “safe” badge must not promise semantic safety.

Trusted-site search reports whether an origin matches the configured list; it does not report or grant connection permissions. Remembered account/network grants belong to session details, where they can be changed or revoked.

While locked, retain only enough request metadata for safe resumption. Unlocking does not approve the request. Revalidate expiry, origin and context before showing an actionable review. Switching to another request cannot combine the first request's payload with the second request's identity. Request cancellation retires only the owned request.

### Privacy

Keep Privacy in Tools and allow a contextual entry from Wallet. The hub has two clear sections: **Private notes** and **Pool data**. The current source scope is the pinned Ethereum Mainnet Tornado Classic pool registry; mobile must not imply that this is a generic privacy capability on Syscoin or every EVM chain.

The primary note summary distinguishes verified balance from pending/unverified notes. Note rows show denomination and deposit/status evidence without exposing the bearer secret. Detail offers status, withdrawal and password-confirmed backup. The extension supports password-confirmed individual note import/reveal and an encrypted backup of the notes in the current wallet profile. Mobile uses the same encrypted file format and restore service. File selection happens before note authorization; the saved state follows readback of the written encrypted bytes, and verification requires reopening those bytes with the backup password. Internal encrypted-vault limits are separate from the portable file limit. Explain that the recovery phrase does not restore private notes.

Deposit review includes pool/network, source, denomination, maximum fee, total and a note-backup obligation. Withdrawal separates direct and relayed operation: gas payer, relayer identity, relayer fee, amount received and relevant privacy tradeoffs. Local proof preparation has honest progress/cancellation/interruption states. “Relayer accepted” is separate from mined/verified completion.

Pool-data preparation shows downloading, verifying, paused, ready and unavailable states. Public cache controls are separate from secret-note removal. Service settings identify the endpoint and consequences of changing it. Capacity changes show current count, limit, storage/version implications and do not silently truncate notes. Completed-note cleanup explains any RPC-visible linkage and reports unresolved records kept in place.

### Smart accounts

The Smart account hub begins with its account address, chain and deployment state. Follow with the active sign-in method, installed modules and recovery status. Preserve the difference between ECDSA, passkey, SLH-DSA, composite and custom validators. A post-quantum module does not justify a global “quantum-safe wallet” claim.

Set-up and policy changes are multi-step native flows: choose method, explain prerequisites, configure, review on-chain/local effects, authorize, then reconcile actual status. Composite policy uses readable “2 of 3 methods” summaries, names each method and prevents a policy that cannot reach the threshold with supported signers. Removing the active/required validator is not an ordinary list swipe.

The current guardian-recovery UI configures one guardian address with threshold 1; that guardian may itself be a supported smart account. This is distinct from the configurable threshold among composite signing methods. Mobile parity must not turn it into a built-in 2-of-3 guardian setup. Guardian recovery shows that guardian identity, requested action, delay/ready/expiry times, current observation time and pending/local-versus-observed status. Do not display an outdated locally requested state as final chain state. Passkey setup retains RP/origin/native association requirements; a native prompt without verified validator compatibility is not parity.

Custom validators are in an advanced subflow with address/init data, current chain, preflight result and explicit consequence review. Current dapp-requested install/uninstall consent is validator-only; it must not advertise arbitrary executor or hook installation. Supported built-in modules, including guardian recovery, retain their separate module semantics. Passing interface/code checks is not a security endorsement. Infrastructure readiness checks the configured factory/contracts and offers deliberate deployment where supported. An arbitrary bundler/paymaster endpoint editor is not an existing parity feature, and visiting the hub must not silently deploy contracts.

### Sentry

Use “Sentry” as the Syscoin signing/governance feature, not an analytics label. The hub shows authority keys by role, protected collateral, and trusted data service settings. Role names owner/operator/voting/collateral remain visible through import and review. Keep key algorithm/type separate from role; batch import includes validation, count, issues, backup acknowledgment and limits.

Sentry operation, link and vote reviews have their own action summaries and current network/service attribution. Show exact authorized changes, applicable fee authorization and who submits the resulting transaction. Removing a local key and unlocking protected collateral are different actions. The latter explains the impact on the node and requires deliberate confirmation, not a casual swipe-to-delete.

### Accounts, recovery and settings

Account management preserves seed-derived/imported/watch-only/hardware/smart distinctions. Renaming does not change identity. Removing an account and forgetting the wallet explain which local records and secrets are affected, plus what is required to restore each type. A detected storage failure is a repair/error screen, never an invitation to create a new wallet over unreadable data.

Biometric unlock is an optional Security & backups setting. Enrolling requires the wallet password and a device-protected unlock credential. Offer the password on the unlock screen when biometrics are unavailable, canceled, or no longer enrolled. Wallet recovery and fresh-password checks for secret reveal remain separate. This feature needs physical-device qualification before it is enabled.

Security presents auto-lock, supported native privacy behavior and unlock methods. Preferences include language/currency and balance visibility. Advanced settings hold infrastructure/provider/diagnostic controls without becoming the only route to ordinary backups. The Recovery center inventories seed, imported keys, private notes and authenticator dependencies independently; one checkmark does not imply that everything is backed up.

## Visual system

Use semantic tokens shared with the extension instead of copying scattered colors. The current extension basis is `palette.js`, `tailwind.config.js` and `source/assets/fonts/`. A mobile token layer may map native sizes differently while retaining semantic names.

| Token family                       | Native target                                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base / raised / elevated / overlay | `#07152A` / `#111E33` / `#162742` / `#1E365C` from the extension                                                                                                                                                                                                           |
| Primary text / muted text          | `#FFFFFF` / `#A2A5AB`; lighter emphasis where needed for contrast                                                                                                                                                                                                          |
| Action accents                     | Pali pink `#FF3E91` for the main forward action; blue `#4CA1CF` for secondary emphasis. Use tested foreground contrast, not white by habit.                                                                                                                                |
| Error foreground                   | Existing readable `#ff8f8f`; destructive fill/border uses a separate token                                                                                                                                                                                                 |
| Typography                         | Poppins brand/headings where packaged and measured; native system text can be used for dense content and platform controls. Balance 34-40, title 28-32, section 20-22, body 17, secondary 15, metadata 13 points at default scale. Tabular figures for comparable amounts. |
| Spacing                            | 4-point rhythm; 16 compact phone gutters, 20 regular phone gutters, 24 or greater on expanded layouts. Use 8/12 inside closely related groups and 24/32 between sections.                                                                                                  |
| Shape                              | Preserve named field/card/sheet/pill roles. Starting mobile mapping: field 12-16, card 20, sheet 24, pill fully rounded. These adapt the extension's 8/16/20-pixel roles and must remain one consistent scale.                                                             |
| Controls                           | Primary button at least 52 high; all independent touch targets at least 48 by 48. Rows at least 64-72 when subtitle content is present, expanding for text size.                                                                                                           |
| Icons and assets                   | One consistent native vector style; network logos keyed to verified identity. Icons supplement labels. Do not mix emoji, filled vendor marks and unrelated stroke weights as interchangeable controls.                                                                     |
| Motion                             | Short, restrained state transitions; press feedback is immediate. Respect Reduce Motion. Never animate a delayed request into appearing approved or successful.                                                                                                            |

The figures above are starting layout tokens, not fixed-size containers. Do not truncate destinations, fees, warnings or localized labels to preserve a screenshot. Balance rows may reflow; secret/address blocks wrap intentionally. Avoid glass/translucency behind transaction details or low-contrast borders if it harms readability. System-native materials can be used for navigation chrome when they remain legible.

## Reusable native components

- **App shell:** safe-area-aware header, account/network selectors, stable tab/sidebar navigation, request coordinator and interruptible screen stack.
- **Identity block:** account type/name, full public identifier when needed, network badge, chain family, copy/explorer actions with accessible names.
- **Asset row:** stable identity, icon, name, chain/contract provenance, amount and explicit unavailable state.
- **Amount field:** asset selector, decimal precision, balance/fee state and Max behavior from domain rules, not formatted-fiat arithmetic.
- **Review summary:** source/destination/asset/amount/fees plus operation-specific sections; frozen context and expiry status; inspectable raw details.
- **Action footer:** measured content height, keyboard-safe placement and relevant inline error. Its last line must remain reachable at large text sizes.
- **Status panel:** text/icon/progress, evidence/freshness and a scoped action. “Retry” only where repeating is safe; otherwise “Check status”.
- **Secret surface:** native privacy handling, explicit reveal authorization, short-lived secret state and controlled export. Never implement as a general selectable card in the ordinary list tree.
- **Confirmation sheet:** clear consequence, primary action label naming the mutation, Cancel, and focus restoration. Do not stack sheets until context is lost.
- **Capability notice:** unmet requirement plus a relevant route, such as choose account/network or view compatibility; never a fake working control.

## Responsive and accessibility behavior

Use one vertical scroll owner per screen. Insets include top cutouts, system bars, bottom home indicator, landscape edges and software keyboard. The keyboard must not cover the active field, validation message or next action. Read actual viewport/safe-area changes; do not copy the extension's 400 by 620 popup assumptions or add an arbitrary footer spacer.

Review at 320 by 568, 360 by 800, 393 by 852 and 430 by 932 point layouts, landscape, and at least one expanded tablet/split view. Text must remain usable at 200% size. Let rows/cards grow and switch amount/value pairs to stacked layouts as needed. Support VoiceOver/TalkBack reading order, state announcements, descriptive action names, keyboard focus and external keyboard navigation where the OS exposes it. Colors, vibration and animation are never the only indication of a result.

Use native back behavior: dismiss the top sheet first; return within the current flow next; do not silently clear unrelated drafts. A potentially destructive exit offers a precise discard decision. Before submission, cancellation is ordinary. After submission, leaving the screen does not cancel the chain operation.

The [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility) supports scalable text and multiple ways to perceive state. [Apple's tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars) supports stable labeled destinations that preserve navigation state. [Android's layout guidance](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-basics) calls for adaptable orientations, safe areas and keyboard-aware inputs. These inform the native layout; they do not establish that a specific build complies.

## Complete state design

| State                                | Required presentation and behavior                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Initializing authority               | Branded but quiet loading state; no empty-wallet inference and no editable privileged controls                 |
| Locked                               | Unlock/recovery routes only; fresh validation required for queued requests after unlock                        |
| True empty                           | Explain what is absent and offer the appropriate first action                                                  |
| Loading/refetch                      | Retain known data when safe, indicate refresh, prevent duplicate mutations                                     |
| Stale/partial                        | Label freshness and incomplete sources; do not convert unknown balance/price/history to zero                   |
| Offline                              | Show offline status and cached provenance; prevent actions requiring fresh evidence                            |
| Failed read/storage unavailable      | Provide retry/repair path without overwriting records or offering destructive recovery as the default          |
| Wrong account/network                | Explain the required context and offer a deliberate switch; invalidate the old review                          |
| Unsupported hardware/capability      | Show the reason and safe alternative; preserve all existing records                                            |
| Validation error                     | Field-associated readable message; retain non-secret draft input, focus the field appropriately                |
| Preparing proof/hardware/native auth | Show current operation and available cancel semantics; distinguish waiting on device from network wait         |
| Submitted/unknown                    | Retain operation identity; surface evidence and status checking, avoid automatic resubmission                  |
| Confirmed/reverted/replaced          | Explicit outcome and receipt/related-operation navigation; only confirmed success gets final-success treatment |
| Secret surface interrupted           | Remove revealed content, retire its authorization, return to a safe state                                      |

## Capability and parity tracking

Maintain three independent statuses for every screen family: **designed**, **implemented**, **native-validated**. A rendered screen demonstrates only the first or second. “Not enabled in this build” is temporary implementation status, not removal from the full product scope.

Before enabling a feature, check wallet/account type, chain family/ID, network endpoint, session generation, supported signer, storage readiness and required native service. Record each supported combination rather than a single global “mobile supported” flag. A disabled feature explains its actual unmet condition. Changes to capability cannot delete or corrupt records created by a more capable host.

A mobile release claiming extension equivalence must satisfy the following coverage:

| Area                     | Parity acceptance                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet lifecycle         | Create/import, persist, cold restart, lock/unlock, safe migration, recovery and deliberate removal preserve the extension's identity/durability invariants                       |
| Account/network coverage | Supported HD/imported/watch-only/hardware/smart types and EVM/UTXO networks have explicit acceptance; any remaining gap is disclosed before release                              |
| Assets/history           | Native tokens, applicable SPTs/NFTs, import/removal, exact units, pagination, empty/error/stale states and transaction detail remain available                                   |
| Transactions             | Native/token/NFT/UTXO sends, fees, PSBT reviews, messages, typed data, relevant encryption and batch semantics match supported extension operations                              |
| Connections              | Account/network grants, connect/change/disconnect, trusted sites and request correlation remain scoped and enforceable through the chosen native transport                       |
| Privacy                  | Note import/deposit/withdraw/backup, public pool sync, capacity, cleanup and all interruption/unknown-submission states work without secret loss or misleading status            |
| Smart accounts           | Deployment, authenticators, modules/composite policies, recovery and infrastructure preserve chain identity and lockout protections on qualified native paths                    |
| Sentry                   | Role-separated keys, batch import, collateral protection, trusted service and operation/link/vote authorization remain available on the applicable Syscoin networks              |
| Settings/security        | Localization, currency, auto-lock, disclosure/export, backup scope, hardware setup and equivalent provider controls preserve their consequences                                  |
| Native behavior          | Physical-device keyboard, safe areas, accessibility, back/gestures, clipboard, camera, background snapshots, biometric/key-store failure and process death have passing evidence |

Do not check a parity item merely because a wrapper screen or fixture exists. The implemented native flow needs its own qualification evidence. Watch-only and preview modes cannot validate custody or signing rows in this table.

## Design acceptance criteria

1. The explorer covers every source family above and lets a reviewer inspect the key normal, empty, error, unsupported and pending states without entering secrets or using live funds.
2. The primary user journeys can be completed coherently in the design: create/import, portfolio/send/receive, account/network change, backup/recovery, app approval, privacy, smart-account management and Sentry. Native authorization handoffs are visibly identified rather than simulated as real approval.
3. Every privileged review shows the correct account/network/origin and complete material effects. No screen suggests connection equals permission to spend, seed equals every backup, submitted equals confirmed, or a known token symbol equals verified identity.
4. All phone sizes and text scaling targets remain legible and reachable. A reviewer can identify primary action, cancellation, loading and failure without relying on color or animation.
5. Sample data is persistently labeled, separated from operational state and unable to produce payment QRs, secrets or network mutations. “Preview” buttons do not claim an actual transaction or backup succeeded.
6. Product design approval records the chosen information architecture, screen families, interaction rules and known open choices. It is separate from native security review, physical-device qualification, feature-parity sign-off and store release approval.

## Implementation sequence without reducing scope

First settle the full screen families, reusable components and review patterns in the interactive explorer. Then connect native wallet authority, durable storage and lifecycle handling while retaining the reviewed presentation. Bring each transaction family and advanced tool online behind measured capability gates, reusing existing domain tests and adding host-specific evidence. Keep a visible coverage matrix so temporary gaps do not disappear into an apparently finished home screen.

The efficient shared-code strategy is incremental: shared pure types, exact validators, review models and state machines first; host adapters and authority boundaries next; native presentation remains separate from the extension DOM. A simultaneous cryptographic rewrite, global bundler migration and UI rewrite is unnecessary for this product design.
