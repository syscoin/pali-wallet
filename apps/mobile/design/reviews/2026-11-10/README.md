# Pali mobile screen review — 10 November 2026

Latest flow updates: [selected account, Send, Activity and alerts](#selected-account-send-activity-and-alert-updates) · [recovery, shared authentication and decoded asset reviews](#current-flow-updates) · [contact sheet](flow-updates/contact-sheet.png) · [per-frame provenance](flow-updates/manifest.json).

The 32 reference screens below compare the supplied PDF with **actual implemented React Native components**. Home, Send, Receive and Activity also include video stills. Each screen includes a narrow 320px capture.

Original comparison source: `04466c2e9498dfd250ac575e393db72fceec0e1f`. These are browser renders with public synthetic wallet, network and connection adapters. They demonstrate presentation and navigation; they do not qualify native biometrics, camera, hardware, protected storage or funded transactions. The displayed recovery phrase is a public test phrase.

The update implements six-digit PIN creation/confirmation, optional native biometric entry, locked and recovery flows, operation-bound send authorization, and ordered-word backup verification. Native prompt behavior requires its own qualification. The shared SDK candidate and its pending release are documented in `vendor/sysweb3-operation/REVIEWED-CANDIDATE.json`.

Remaining gaps are stated per screen. Native background notification delivery is not qualified by these browser captures, and page 28 shows the browser camera fallback rather than a fabricated camera state.

[All-screen contact sheet](contact-sheet.png) · [Capture manifest](manifest.json) · [Additional implemented screens](extras/README.md)

Conditional states: [PIN-only send authorization](actual/actual-13-pin.png) · [Local transaction detail after View transaction](actual/actual-14-local-detail.png) · [Unbacked wallet and Settings](extras/README.md) · [Backed-up removal](actual/actual-26-backed-up.png) · [Populated connections](actual/actual-27-connected.png) · [Populated connections at 320px](actual/actual-27-connected-320.png)

| PDF page | Comparison | Narrow actual | Presentation status |
| --- | --- | --- | --- |
| 01 | [Welcome](01-welcome.png) | [320px](actual/actual-01-320.png) | implemented |
| 02 | [Create PIN](02-create-pin.png) | [320px](actual/actual-02-320.png) | implemented |
| 03 | [Confirm PIN](03-confirm-pin.png) | [320px](actual/actual-03-320.png) | implemented |
| 04 | [Fingerprint](04-fingerprint.png) | [320px](actual/actual-04-320.png) | implemented |
| 05 | [Import wallet](05-import-wallet.png) | [320px](actual/actual-05-320.png) | implemented |
| 06 | [Confirm restored wallet](06-confirm-restored-wallet.png) | [320px](actual/actual-06-320.png) | implemented |
| 07 | [Locked](07-locked.png) | [320px](actual/actual-07-320.png) | implemented |
| 08 | [Recover access](08-recover-access.png) | [320px](actual/actual-08-320.png) | implemented |
| 09 | [Wallet Home](09-wallet-home.png) | [320px](actual/actual-09-320.png) | implemented |
| 10 | [Choose Send network](10-choose-send-network.png) | [320px](actual/actual-10-320.png) | implemented |
| 11 | [Send details](11-send-details.png) | [320px](actual/actual-11-320.png) | implemented |
| 12 | [Review Send](12-review-send.png) | [320px](actual/actual-12-320.png) | adapted |
| 13 | [Authorize Send](13-authorize-send.png) | [320px](actual/actual-13-320.png) | implemented |
| 14 | [Send submitted](14-send-submitted.png) | [320px](actual/actual-14-320.png) | implemented |
| 15 | [Choose Receive network](15-choose-receive-network.png) | [320px](actual/actual-15-320.png) | implemented |
| 16 | [Receive backup warning](16-receive-backup-warning.png) | [320px](actual/actual-16-320.png) | implemented |
| 17 | [Receive](17-receive.png) | [320px](actual/actual-17-320.png) | implemented |
| 18 | [Activity](18-activity.png) | [320px](actual/actual-18-320.png) | implemented |
| 19 | [Transaction details](19-transaction-details.png) | [320px](actual/actual-19-320.png) | adapted |
| 20 | [Backup introduction](20-backup-introduction.png) | [320px](actual/actual-20-320.png) | implemented |
| 21 | [Recovery phrase](21-recovery-phrase.png) | [320px](actual/actual-21-320.png) | implemented |
| 22 | [Verify backup](22-verify-backup.png) | [320px](actual/actual-22-320.png) | implemented |
| 23 | [Backup complete](23-backup-complete.png) | [320px](actual/actual-23-320.png) | implemented |
| 24 | [Settings](24-settings.png) | [320px](actual/actual-24-320.png) | adapted |
| 25 | [Security](25-security.png) | [320px](actual/actual-25-320.png) | implemented |
| 26 | [Remove wallet](26-remove-wallet.png) | [320px](actual/actual-26-320.png) | adapted |
| 27 | [WalletConnect](27-walletconnect.png) | [320px](actual/actual-27-320.png) | implemented |
| 28 | [Scan WalletConnect QR](28-scan-walletconnect-qr.png) | [320px](actual/actual-28-320.png) | native-only |
| 29 | [Pairing preview](29-pairing-preview.png) | [320px](actual/actual-29-320.png) | adapted |
| 30 | [Connection request](30-connection-request.png) | [320px](actual/actual-30-320.png) | adapted |
| 31 | [Connected app details](31-connected-app-details.png) | [320px](actual/actual-31-320.png) | implemented |
| 32 | [Transaction request](32-transaction-request.png) | [320px](actual/actual-32-320.png) | adapted |

<details>
<summary>01. Welcome</summary>

Centered Pali identity, subtle native-vector glow and dot pattern, direct Create/Import actions, and quiet watch-account entry.

![Welcome: reference and implementation](01-welcome.png)

[Actual 390px](actual/actual-01.png) · [Actual 320px](actual/actual-01-320.png)

Component: `Onboarding.Welcome`

</details>

<details>
<summary>02. Create PIN</summary>

Dedicated six-digit keypad. The PIN authorizes a device-protected random vault secret; it is not used as the SDK encryption password.

![Create PIN: reference and implementation](02-create-pin.png)

[Actual 390px](actual/actual-02.png) · [Actual 320px](actual/actual-02-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>03. Confirm PIN</summary>

Separate matching-PIN step; mismatch resets confirmation for a fresh attempt.

![Confirm PIN: reference and implementation](03-confirm-pin.png)

[Actual 390px](actual/actual-03.png) · [Actual 320px](actual/actual-03-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>04. Fingerprint</summary>

Separate optional enrollment with Not now and Pali PIN fallback. Native wording follows eligible Face ID, Touch ID or Android biometrics; browser adapter cannot demonstrate the OS prompt.

![Fingerprint: reference and implementation](04-fingerprint.png)

[Actual 390px](actual/actual-04.png) · [Actual 320px](actual/actual-04-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>05. Import wallet</summary>

Numbered 12/24-word entry. Phrase verification uses the existing shared SDK; no automatic clipboard read.

![Import wallet: reference and implementation](05-import-wallet.png)

[Actual 390px](actual/actual-05.png) · [Actual 320px](actual/actual-05-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>06. Confirm restored wallet</summary>

Public address preview precedes security setup. This fixture displays a public synthetic EVM address; the production preview uses shared EVM/UTXO derivation.

![Confirm restored wallet: reference and implementation](06-confirm-restored-wallet.png)

[Actual 390px](actual/actual-06.png) · [Actual 320px](actual/actual-06-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>07. Locked</summary>

Pali PIN keypad, enrolled biometric entry and Forgot PIN. No watch-account bypass of the locked wallet.

![Locked: reference and implementation](07-locked.png)

[Actual 390px](actual/actual-07.png) · [Actual 320px](actual/actual-07-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>08. Recover access</summary>

Updated source: `ca14d91409defadcd45f0cd044cf3eccae02cada`.

Phrase verification, wallet confirmation and new PIN setup. Retained independent keys/notes still depend on their recovery material; a seed does not derive unrelated keys.

![Recover access: reference and implementation](08-recover-access.png)

[Actual 390px](actual/actual-08.png) · [Actual 320px](actual/actual-08-320.png)

Component: `NativeRecovery`

</details>

<details>
<summary>09. Wallet Home</summary>

The selected EVM account across its added networks. Account and network-filter controls are separate. Concrete filters restore before reads and never fetch sibling accounts or hidden networks; UTXO retains its own network view.

![Wallet Home: reference and implementation](09-wallet-home.png)

[Actual 390px](actual/actual-09.png) · [Actual 320px](actual/actual-09-320.png)

Component: `NativeAccountOverview + AccountPortfolioController + RealAppShell`

</details>

<details>
<summary>10. Choose Send network</summary>

All networks opens the compact network-only Send from sheet with known native balances. A concrete network and UTXO Send enter directly. The fixed-network form has a searchable saved-asset picker; asset changes preserve only the same-network recipient and clear amount/review.

![Choose Send network: reference and implementation](10-choose-send-network.png)

[Actual 390px](actual/actual-10.png) · [Actual 320px](actual/actual-10-320.png)

Component: `NetworkSourceSheet`

</details>

<details>
<summary>11. Send details</summary>

Selected asset and network, available amount, recipient scan and bounded MAX/advanced controls. Exact balance and fee semantics remain.

![Send details: reference and implementation](11-send-details.png)

[Actual 390px](actual/actual-11.png) · [Actual 320px](actual/actual-11-320.png)

Component: `NativeSend`

</details>

<details>
<summary>12. Review Send</summary>

Recipient, network, amount, fee and total precede extended fee explanations. One primary Send action and Back to edit.

![Review Send: reference and implementation](12-review-send.png)

[Actual 390px](actual/actual-12.png) · [Actual 320px](actual/actual-12-320.png)

Component: `NativeSend`

</details>

<details>
<summary>13. Authorize Send</summary>

When enabled, biometrics are requested automatically once. The same authorization page keeps PIN fallback and a biometric retry button. This capture shows the fallback after a simulated refusal; no real OS prompt is represented.

![Authorize Send: reference and implementation](13-authorize-send.png)

[Actual 390px](actual/actual-13.png) · [Actual 320px](actual/actual-13-320.png)

Component: `NativeSend`

</details>

<details>
<summary>14. Send submitted</summary>

Amount, asset, recipient and network remain visible with View transaction and Done. View transaction opens in-app detail; explorer is a separate action. Cancellation/replacement and uncertain outcomes retain their own wording.

![Send submitted: reference and implementation](14-send-submitted.png)

[Actual 390px](actual/actual-14.png) · [Actual 320px](actual/actual-14-320.png)

Component: `NativeSend`

</details>

<details>
<summary>15. Choose Receive network</summary>

Contextual shared catalogue picker; Cancel restores Receive. A changed network projects its own current address and resets backup-warning acknowledgement.

![Choose Receive network: reference and implementation](15-choose-receive-network.png)

[Actual 390px](actual/actual-15.png) · [Actual 320px](actual/actual-15-320.png)

Component: `NativeNetworks`

</details>

<details>
<summary>16. Receive backup warning</summary>

Bottom sheet with warning shield, Back Up Now and Receive Anyway. Acknowledgement is bound to the selected account/network.

![Receive backup warning: reference and implementation](16-receive-backup-warning.png)

[Actual 390px](actual/actual-16.png) · [Actual 320px](actual/actual-16-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>17. Receive</summary>

Actual address, generated QR and Copy/Share actions for the selected account and network.

![Receive: reference and implementation](17-receive.png)

[Actual 390px](actual/actual-17.png) · [Actual 320px](actual/actual-17-320.png)

Component: `NativePortfolio`

</details>

<details>
<summary>18. Activity</summary>

Activity follows the selected account and network filter. All merges added EVM networks newest first with network badges; every detail remains bound to its original network and transaction.

![Activity: reference and implementation](18-activity.png)

[Actual 390px](actual/actual-18.png) · [Actual 320px](actual/actual-18-320.png)

Component: `AllNetworksActivity + AccountActivityController + RealAppShell`

</details>

<details>
<summary>19. Transaction details</summary>

Centered status/amount and compact facts. Applicable retry, speed-up and cancellation actions remain outside expandable technical details.

![Transaction details: reference and implementation](19-transaction-details.png)

[Actual 390px](actual/actual-19.png) · [Actual 320px](actual/actual-19-320.png)

Component: `NativeActivityScreen`

</details>

<details>
<summary>20. Backup introduction</summary>

Shield hero, three concise steps and fixed Back Up Now / Do It Later. Phrase access is authenticated after this introduction.

![Backup introduction: reference and implementation](20-backup-introduction.png)

[Actual 390px](actual/actual-20.png) · [Actual 320px](actual/actual-20-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>21. Recovery phrase</summary>

Bounded protected phrase display using a public known test phrase in this fixture. Continue leads to actual ordered-word verification.

![Recovery phrase: reference and implementation](21-recovery-phrase.png)

[Actual 390px](actual/actual-21.png) · [Actual 320px](actual/actual-21-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>22. Verify backup</summary>

Shuffled word choices and ordered answer slots. Completion requires the actual matching answer and current presentation; acknowledgement alone cannot mark backup verified.

![Verify backup: reference and implementation](22-verify-backup.png)

[Actual 390px](actual/actual-22.png) · [Actual 320px](actual/actual-22-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>23. Backup complete</summary>

Centered success state, one Done action, no redundant Back control.

![Backup complete: reference and implementation](23-backup-complete.png)

[Actual 390px](actual/actual-23.png) · [Actual 320px](actual/actual-23-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>24. Settings</summary>

Root tab without Back, backup badge when needed, connection management and Security access. Notifications remain a separately tracked implementation gap; this screen is not full parity signoff.

![Settings: reference and implementation](24-settings.png)

[Actual 390px](actual/actual-24.png) · [Actual 320px](actual/actual-24-320.png)

Component: `RealSettings`

</details>

<details>
<summary>25. Security</summary>

Change PIN, optional native biometric access, Auto-lock and Privacy mode. Auto-lock lives here, with fresh authorization for security-reducing changes.

![Security: reference and implementation](25-security.png)

[Actual 390px](actual/actual-25.png) · [Actual 320px](actual/actual-25-320.png)

Component: `NativeSecurity`

</details>

<details>
<summary>26. Remove wallet</summary>

Reference-style destructive review with bottom actions and conditional red backup warning. The countdown is removed from presentation; expiry and authorization remain enforced. Confirmed-backup variant is linked separately.

![Remove wallet: reference and implementation](26-remove-wallet.png)

[Actual 390px](actual/actual-26.png) · [Actual 320px](actual/actual-26-320.png)

Component: `NativeWalletRemovalScreen`

</details>

<details>
<summary>27. WalletConnect</summary>

Scan/paste entry and Active connections. Populated-list captures are linked beside the empty-state capture; clipboard is read only on tap.

![WalletConnect: reference and implementation](27-walletconnect.png)

[Actual 390px](actual/actual-27.png) · [Actual 320px](actual/actual-27-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>28. Scan WalletConnect QR</summary>

Native scanner implements camera ownership, close, flashlight and review reassurance. Browser capture is its fallback; native camera and permission behavior require device/emulator evidence.

![Scan WalletConnect QR: reference and implementation](28-scan-walletconnect-qr.png)

[Actual 390px](actual/actual-28.png) · [Actual 320px](actual/actual-28-320.png)

Component: `ConnectionQrScanner.web`

</details>

<details>
<summary>29. Pairing preview</summary>

Spinner, selected network and authoritative expiry; no invented app identity before its proposal. Pairing does not grant account access.

![Pairing preview: reference and implementation](29-pairing-preview.png)

[Actual 390px](actual/actual-29.png) · [Actual 320px](actual/actual-29-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>30. Connection request</summary>

Reported origin and site verification, selected account/network, then requested permissions. Fixed Reject/Connect actions; browser state is synthetic.

![Connection request: reference and implementation](30-connection-request.png)

[Actual 390px](actual/actual-30.png) · [Actual 320px](actual/actual-30-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>31. Connected app details</summary>

Isolated app detail with network, account, permissions, expiry and bottom Disconnect. Last-used is omitted because the wallet has no authoritative measurement.

![Connected app details: reference and implementation](31-connected-app-details.png)

[Actual 390px](actual/actual-31.png) · [Actual 320px](actual/actual-31-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>32. Transaction request</summary>

Updated source: `a7c370a22656574043007ccc8d15fe2af342351a`.

Supported ERC-20, ERC-721 and ERC-1155 calls show the asset movement, exact quantity or ID, recipient and contract before confirmation. Unknown calls label the native currency separately. The new examples and narrow scrolled facts are below; existing approval safeguards remain.

![Transaction request: reference and implementation](32-transaction-request.png)

[Actual 390px](actual/actual-32.png) · [Actual 320px](actual/actual-32-320.png)

Component: `NativeTransactionReviewScreen`

</details>

## Additional implemented screens without PDF references

These use the same visual system and real components with synthetic public fixtures. Native device qualification remains separate.

<details>
<summary>01-watch-wallet: Watch-only account</summary>

Component: `App / RealPortfolio`

![Watch-only account at 390px](extras/01-watch-wallet-390.png)

![Watch-only account at 320px](extras/01-watch-wallet-320.png)

</details>

<details>
<summary>02-account-manager: Native account manager</summary>

Component: `NativeAccounts`

![Native account manager at 390px](extras/02-account-manager-390.png)

![Native account manager at 320px](extras/02-account-manager-320.png)

</details>

<details>
<summary>03-create-account: Create another software account</summary>

Component: `NativeAccounts`

![Create another software account at 390px](extras/03-create-account-390.png)

![Create another software account at 320px](extras/03-create-account-320.png)

</details>

<details>
<summary>04-network-add: Add a custom network</summary>

Component: `NativeNetworks`

![Add a custom network at 390px](extras/04-network-add-390.png)

![Add a custom network at 320px](extras/04-network-add-320.png)

</details>

<details>
<summary>05-token-assets: Token assets</summary>

Component: `NativePortfolio`

![Token assets at 390px](extras/05-token-assets-390.png)

![Token assets at 320px](extras/05-token-assets-320.png)

</details>

<details>
<summary>06-import-token: Import token / find holdings</summary>

Component: `NativeTokens`

![Import token / find holdings at 390px](extras/06-import-token-390.png)

![Import token / find holdings at 320px](extras/06-import-token-320.png)

</details>

<details>
<summary>07-token-review: Verified token preview</summary>

Component: `NativeTokens`

![Verified token preview at 390px](extras/07-token-review-390.png)

![Verified token preview at 320px](extras/07-token-review-320.png)

</details>

<details>
<summary>08-collectible-discovery: Collectible discovery</summary>

Component: `NativeTokens`

![Collectible discovery at 390px](extras/08-collectible-discovery-390.png)

![Collectible discovery at 320px](extras/08-collectible-discovery-320.png)

</details>

<details>
<summary>09-collectible-ownership: Collectible ownership form</summary>

Component: `NativeTokens / CollectibleOwnership`

![Collectible ownership form at 390px](extras/09-collectible-ownership-390.png)

![Collectible ownership form at 320px](extras/09-collectible-ownership-320.png)

</details>

<details>
<summary>10-evm-nonce: EVM advanced nonce</summary>

Component: `NativeSend`. MAX is inside the amount field, with the available balance below it.

![EVM advanced nonce at 390px](extras/10-evm-nonce-390.png)

![EVM advanced nonce at 320px](extras/10-evm-nonce-320.png)

</details>

<details>
<summary>11-utxo-advanced: UTXO advanced transaction options</summary>

Component: `NativeUtxoSend`

![UTXO advanced transaction options at 390px](extras/11-utxo-advanced-390.png)

![UTXO advanced transaction options at 320px](extras/11-utxo-advanced-320.png)

</details>

<details>
<summary>12-erc20-send: ERC-20 transfer form</summary>

Component: `NativeSend`

![ERC-20 transfer form at 390px](extras/12-erc20-send-390.png)

![ERC-20 transfer form at 320px](extras/12-erc20-send-320.png)

</details>

<details>
<summary>13-erc1155-send: ERC-1155 transfer form</summary>

Component: `NativeSend`

![ERC-1155 transfer form at 390px](extras/13-erc1155-send-390.png)

![ERC-1155 transfer form at 320px](extras/13-erc1155-send-320.png)

</details>

<details>
<summary>14-guardian-policy: Guardian policy and status</summary>

Component: `NativeGuardianPolicy`

![Guardian policy and status at 390px](extras/14-guardian-policy-390.png)

![Guardian policy and status at 320px](extras/14-guardian-policy-320.png)

</details>

<details>
<summary>15-guardian-policy-edit: Guardian policy editor</summary>

Component: `NativeGuardianPolicy`

![Guardian policy editor at 390px](extras/15-guardian-policy-edit-390.png)

![Guardian policy editor at 320px](extras/15-guardian-policy-edit-320.png)

</details>

<details>
<summary>16-smart-guardian-recovery: Smart guardian / separate payer recovery</summary>

Component: `NativeGuardianRecovery`

![Smart guardian / separate payer recovery at 390px](extras/16-smart-guardian-recovery-390.png)

![Smart guardian / separate payer recovery at 320px](extras/16-smart-guardian-recovery-320.png)

</details>

<details>
<summary>17-guardian-recovery-review: Guardian recovery proof review</summary>

Component: `NativeGuardianRecovery`

![Guardian recovery proof review at 390px](extras/17-guardian-recovery-review-390.png)

![Guardian recovery proof review at 320px](extras/17-guardian-recovery-review-320.png)

</details>

<details>
<summary>18-slh-keys: SLH-DSA prepared keys</summary>

Component: `NativeSlhDsaManagement`

![SLH-DSA prepared keys at 390px](extras/18-slh-keys-390.png)

![SLH-DSA prepared keys at 320px](extras/18-slh-keys-320.png)

</details>

<details>
<summary>19-slh-installed: SLH-DSA installed keys</summary>

Component: `NativeSlhDsaManagement`. The shield identifies the authenticator; a green checkmark and Installed badge mark an installed key. Prepared keys show Ready without the checkmark.

![SLH-DSA installed keys at 390px](extras/19-slh-installed-390.png)

![SLH-DSA installed keys at 320px](extras/19-slh-installed-320.png)

</details>

<details>
<summary>20-smart-transfer: Smart account transfer</summary>

Component: `NativeSmartAccountSend`

![Smart account transfer at 390px](extras/20-smart-transfer-390.png)

![Smart account transfer at 320px](extras/20-smart-transfer-320.png)

</details>

<details>
<summary>21-smart-deployment: Smart account deployment authorization</summary>

Component: `NativeSmartAccountOperation`

![Smart account deployment authorization at 390px](extras/21-smart-deployment-390.png)

![Smart account deployment authorization at 320px](extras/21-smart-deployment-320.png)

</details>

<details>
<summary>22-smart-batch: Smart account batched calls</summary>

Component: `NativeSmartTransactionReview`

![Smart account batched calls at 390px](extras/22-smart-batch-390.png)

![Smart account batched calls at 320px](extras/22-smart-batch-320.png)

</details>

<details>
<summary>23-eoa-batch: Software account batched calls</summary>

Component: `NativeTransactionReview`

![Software account batched calls at 390px](extras/23-eoa-batch-390.png)

![Software account batched calls at 320px](extras/23-eoa-batch-320.png)

</details>

<details>
<summary>24-private-deposit: Private deposit form</summary>

Component: `NativePrivateDeposit`

![Private deposit form at 390px](extras/24-private-deposit-390.png)

![Private deposit form at 320px](extras/24-private-deposit-320.png)

</details>

<details>
<summary>25-private-deposit-review: Private deposit review</summary>

Component: `NativePrivateDeposit`

![Private deposit review at 390px](extras/25-private-deposit-review-390.png)

![Private deposit review at 320px](extras/25-private-deposit-review-320.png)

</details>

<details>
<summary>26-private-notes: Private note inventory</summary>

Component: `NativeNoteInventory`

![Private note inventory at 390px](extras/26-private-notes-390.png)

![Private note inventory at 320px](extras/26-private-notes-320.png)

</details>

<details>
<summary>27-private-withdrawal: Private withdrawal form</summary>

Component: `NativePrivateWithdrawal`

![Private withdrawal form at 390px](extras/27-private-withdrawal-390.png)

![Private withdrawal form at 320px](extras/27-private-withdrawal-320.png)

</details>

<details>
<summary>28-import-note: Import private note</summary>

Component: `NativeNoteImport`

![Import private note at 390px](extras/28-import-note-390.png)

![Import private note at 320px](extras/28-import-note-320.png)

</details>

<details>
<summary>29-sentry-keys: Sentry key management</summary>

Component: `NativeSentryKeys`

![Sentry key management at 390px](extras/29-sentry-keys-390.png)

![Sentry key management at 320px](extras/29-sentry-keys-320.png)

</details>

<details>
<summary>30-sentry-service: Sentry service settings</summary>

Component: `NativeSentrySettings`

![Sentry service settings at 390px](extras/30-sentry-service-390.png)

![Sentry service settings at 320px](extras/30-sentry-service-320.png)

</details>

<details>
<summary>31-sentry-nodes: Sentry nodes</summary>

Component: `NativeSentryNodes`

![Sentry nodes at 390px](extras/31-sentry-nodes-390.png)

![Sentry nodes at 320px](extras/31-sentry-nodes-320.png)

</details>

<details>
<summary>32-sentry-consent: Sentry request approval</summary>

Updated source: `a7c370a22656574043007ccc8d15fe2af342351a`. Authorization opens the shared prompt.

Component: `NativeSentryReview`

![Sentry request approval at 390px](extras/32-sentry-consent-390.png)

![Sentry request approval at 320px](extras/32-sentry-consent-320.png)

</details>

<details>
<summary>33-ledger-connect: Ledger discovery</summary>

Component: `NativeLedger`

![Ledger discovery at 390px](extras/33-ledger-connect-390.png)

![Ledger discovery at 320px](extras/33-ledger-connect-320.png)

</details>

<details>
<summary>34-ledger-account: Ledger account review</summary>

Component: `NativeLedger`

![Ledger account review at 390px](extras/34-ledger-account-390.png)

![Ledger account review at 320px](extras/34-ledger-account-320.png)

</details>

<details>
<summary>35-trezor-import: Trezor account import</summary>

Component: `NativeTrezor`

![Trezor account import at 390px](extras/35-trezor-import-390.png)

![Trezor account import at 320px](extras/35-trezor-import-320.png)

</details>

<details>
<summary>36-trezor-smart-resume: Trezor Smart owner continuation</summary>

Component: `NativeTrezorResumeNotice`

Actual resume notice only; Continue is not invoked because this fixture transitions to placeholder review copy.

![Trezor Smart owner continuation at 390px](extras/36-trezor-smart-resume-390.png)

![Trezor Smart owner continuation at 320px](extras/36-trezor-smart-resume-320.png)

</details>

<details>
<summary>37-message-signature: Message signature review</summary>

Component: `NativeMessageReview`

![Message signature review at 390px](extras/37-message-signature-390.png)

![Message signature review at 320px](extras/37-message-signature-320.png)

</details>

<details>
<summary>38-dapp-network-request: Dapp network-change approval</summary>

Component: `NativeDappControlReview`

![Dapp network-change approval at 390px](extras/38-dapp-network-request-390.png)

![Dapp network-change approval at 320px](extras/38-dapp-network-request-320.png)

</details>

<details>
<summary>39-auto-lock: Auto-lock preferences</summary>

Component: `AutoLockSettings`

![Auto-lock preferences at 390px](extras/39-auto-lock-390.png)

![Auto-lock preferences at 320px](extras/39-auto-lock-320.png)

</details>

<details>
<summary>40-biometric-settings: Biometric enrollment settings</summary>

Component: `NativeWallet.native (device-unlock stage)`

![Biometric enrollment settings at 390px](extras/40-biometric-settings-390.png)

![Biometric enrollment settings at 320px](extras/40-biometric-settings-320.png)

</details>

<details>
<summary>41-import-private-key: Import software private key</summary>

Component: `NativeImport`

![Import software private key at 390px](extras/41-import-private-key-390.png)

![Import software private key at 320px](extras/41-import-private-key-320.png)

</details>

<details>
<summary>42-display-currency: Display currency preferences</summary>

Component: `DisplayCurrency`

![Display currency preferences at 390px](extras/42-display-currency-390.png)

![Display currency preferences at 320px](extras/42-display-currency-320.png)

</details>

<details>
<summary>43-languages: Language preferences</summary>

Component: `NativePreferences`

![Language preferences at 390px](extras/43-languages-390.png)

![Language preferences at 320px](extras/43-languages-320.png)

</details>

<details>
<summary>44-help-about: Help and about</summary>

Component: `HelpAbout`

![Help and about at 390px](extras/44-help-about-390.png)

![Help and about at 320px](extras/44-help-about-320.png)

</details>

<details>
<summary>45-private-key-auth: Private-key reveal authorization</summary>

Updated source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065`. Authorization opens the shared prompt.

Component: `NativeSecurity`

![Private-key reveal authorization at 390px](extras/45-private-key-auth-390.png)

![Private-key reveal authorization at 320px](extras/45-private-key-auth-320.png)

</details>

<details>
<summary>46-watch-address-form: Add public watch account</summary>

Component: `Onboarding / AddWatchAccount`

![Add public watch account at 390px](extras/46-watch-address-form-390.png)

![Add public watch account at 320px](extras/46-watch-address-form-320.png)

</details>

<details>
<summary>47-watch-utxo-key: Watch UTXO address, public key or descriptor</summary>

Component: `Onboarding / AddWatchAccount`

![Watch UTXO address, public key or descriptor at 390px](extras/47-watch-utxo-key-390.png)

![Watch UTXO address, public key or descriptor at 320px](extras/47-watch-utxo-key-320.png)

</details>

<details>
<summary>48-asset-details: Native coin details and market chart</summary>

Component: `NativePortfolio / AssetMarketCard`

Healthy chart and market view using explicitly synthetic CoinGecko-shaped data. The production app requests live CoinGecko data.

![Native coin details and market chart at 390px](extras/48-asset-details-390.png)

![Native coin details and market chart at 320px](extras/48-asset-details-320.png)

</details>

<details>
<summary>49-backup-required-home: Wallet with backup still required</summary>

Component: `NativePortfolio / WalletBackupBadge`

![Wallet with backup still required at 390px](extras/49-backup-required-home-390.png)

![Wallet with backup still required at 320px](extras/49-backup-required-home-320.png)

</details>

<details>
<summary>50-market-unavailable: Market data unavailable — offline error state</summary>

Component: `NativePortfolio / AssetMarketCard`

Deliberately blocked network response showing the error and retry state. This is not the normal ETH market screen.

![Market data unavailable — offline error state at 390px](extras/50-market-unavailable-390.png)

![Market data unavailable — offline error state at 320px](extras/50-market-unavailable-320.png)

</details>

<details>
<summary>51-smart-modules: Installed Smart account modules</summary>

Component: `NativeSmartAccountModules`

![Installed Smart account modules at 390px](extras/51-smart-modules-390.png)

![Installed Smart account modules at 320px](extras/51-smart-modules-320.png)

</details>

<details>
<summary>52-custom-validator-consent: Custom validator risk review</summary>

Component: `NativeSmartAccountModules / NativeSmartAccountOperationContent`

![Custom validator risk review at 390px](extras/52-custom-validator-consent-390.png)

![Custom validator risk review at 320px](extras/52-custom-validator-consent-320.png)

</details>

<details>
<summary>53-composite-approvals: Combined approval policy editor</summary>

Component: `NativeSmartAccountModules`

![Combined approval policy editor at 390px](extras/53-composite-approvals-390.png)

![Combined approval policy editor at 320px](extras/53-composite-approvals-320.png)

</details>

<details>
<summary>54-wallet-authenticator: Use Pali wallet — authenticator change</summary>

Component: `NativeSmartAccountAuthenticator / NativeSmartAccountOperationContent`

![Use Pali wallet — authenticator change at 390px](extras/54-wallet-authenticator-390.png)

![Use Pali wallet — authenticator change at 320px](extras/54-wallet-authenticator-320.png)

</details>

<details>
<summary>55-smart-creation-consent: Configured Smart account creation consent</summary>

Component: `NativeSmartPreparationReview`

![Configured Smart account creation consent at 390px](extras/55-smart-creation-consent-390.png)

![Configured Smart account creation consent at 320px](extras/55-smart-creation-consent-320.png)

</details>

<details>
<summary>56-infrastructure-status: Smart account infrastructure status</summary>

Component: `NativeInfrastructure`

![Smart account infrastructure status at 390px](extras/56-infrastructure-status-390.png)

![Smart account infrastructure status at 320px](extras/56-infrastructure-status-320.png)

</details>

<details>
<summary>57-infrastructure-fee: Smart infrastructure deployment fee review</summary>

Component: `NativeInfrastructure`

![Smart infrastructure deployment fee review at 390px](extras/57-infrastructure-fee-390.png)

![Smart infrastructure deployment fee review at 320px](extras/57-infrastructure-fee-320.png)

</details>

<details>
<summary>58-biometric-transaction-auth: Biometric-enabled transaction review</summary>

Component: `NativeSend`

The normal review uses one Confirm and send action. With biometrics enabled, it automatically requests the native proof; the same authorization page retains PIN fallback. No confirmation is pressed in this capture.

![Biometric-enabled transaction review at 390px](extras/58-biometric-transaction-auth-390.png)

![Biometric-enabled transaction review at 320px](extras/58-biometric-transaction-auth-320.png)

</details>

<details>
<summary>59-backup-required-settings: Settings with backup still required</summary>

Component: `RealSettings / WalletBackupBadge`

![Settings with backup still required at 390px](extras/59-backup-required-settings-390.png)

![Settings with backup still required at 320px](extras/59-backup-required-settings-320.png)

</details>

<details>
<summary>60-backup-required-security: Security with unconfirmed backup</summary>

Component: `NativeSecurity`

![Security with unconfirmed backup at 390px](extras/60-backup-required-security-390.png)

![Security with unconfirmed backup at 320px](extras/60-backup-required-security-320.png)

</details>

<details>
<summary>61-change-pin-current: Change PIN — current PIN</summary>

Component: `NativeWallet / PinEntryScreen`

![Change PIN — current PIN at 390px](extras/61-change-pin-current-390.png)

![Change PIN — current PIN at 320px](extras/61-change-pin-current-320.png)

</details>

<details>
<summary>62-change-pin-create: Change PIN — choose new PIN</summary>

Component: `NativeWallet / PinSetup`

![Change PIN — choose new PIN at 390px](extras/62-change-pin-create-390.png)

![Change PIN — choose new PIN at 320px](extras/62-change-pin-create-320.png)

</details>

<details>
<summary>63-change-pin-confirm: Change PIN — confirm new PIN</summary>

Component: `NativeWallet / PinSetup`

![Change PIN — confirm new PIN at 390px](extras/63-change-pin-confirm-390.png)

![Change PIN — confirm new PIN at 320px](extras/63-change-pin-confirm-320.png)

</details>

<details>
<summary>64-pin-transaction-auth: PIN transaction confirmation</summary>

Component: `NativeSend / TransactionAuthentication / PinPad`

Actual PIN authentication UI only. No PIN is entered into this review, no signature or transaction submission is performed.

![PIN transaction confirmation at 390px](extras/64-pin-transaction-auth-390.png)

![PIN transaction confirmation at 320px](extras/64-pin-transaction-auth-320.png)

</details>

<details>
<summary>65-smart-send-form: Smart account send form</summary>

Component: `NativeSmartAccountSend / SendNetworkCard`

![Smart account send form at 390px](extras/65-smart-send-form-390.png)

![Smart account send form at 320px](extras/65-smart-send-form-320.png)

</details>


The two watch-only settings additions below were captured at `f56efcd161caa58a73379d785bdcade27776fdea`. Unchanged earlier frames retain their original source revision in the additional-screen manifest.

<details>
<summary>66-watch-settings: Watch-only settings</summary>

Component: `WatchSession / RealSettings`

![Watch-only settings at 390px](extras/66-watch-settings-390.png)

![Watch-only settings at 320px](extras/66-watch-settings-320.png)

</details>

<details>
<summary>67-watch-auto-lock: Watch-only auto-lock</summary>

Component: `WatchSession / AutoLockSettings`

![Watch-only auto-lock at 390px](extras/67-watch-auto-lock-390.png)

![Watch-only auto-lock at 320px](extras/67-watch-auto-lock-320.png)

</details>

<!-- current-flow-updates:start -->

## Current flow updates

These are actual implemented React Native Web screens. Existing Recover access, transaction-request, private-key and Sentry review images above are updated in place. The additional states below show the next steps and newly decoded asset reviews. Each image records its exact source commit and loaded-asset hashes in the [manifest](flow-updates/manifest.json); unchanged earlier frames retain their original provenance. Synthetic public adapters demonstrate presentation and navigation; they do not qualify OS prompts, protected storage, real notes, files or transactions.

[Validation details](flow-updates/validation.json) record the full watch baseline and each focused retry separately; the unchanged preview suite passed 302 cases.

Recovery verifies the existing wallet before new PIN setup. Sensitive leaves use the shared authentication screen, and portable-file passwords remain separate. Authentication Back was checked in the DOM and by cancellation without entering a PIN.

[Earlier flow contact sheet](flow-updates/contact-sheet.png). Current transfer/Sentry captures are refreshed below and in the final review section.

<details>
<summary>Shared authorization for key reveal</summary>

Component: `NativeOperationAuthentication`.

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 390px.

![Shared authorization for key reveal at 390px](flow-updates/private-key-auth-390.png)

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 320px.

![Shared authorization for key reveal at 320px](flow-updates/private-key-auth-320.png)

</details>

<details>
<summary>Import review without embedded PIN</summary>

Component: `NativeImport`.

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 390px.

![Import review without embedded PIN at 390px](flow-updates/key-import-review-390.png)

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 320px.

![Import review without embedded PIN at 320px](flow-updates/key-import-review-320.png)

</details>

<details>
<summary>Shared authorization for key import</summary>

Component: `NativeOperationAuthentication`.

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 390px.

![Shared authorization for key import at 390px](flow-updates/key-import-auth-390.png)

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 320px.

![Shared authorization for key import at 320px](flow-updates/key-import-auth-320.png)

</details>

<details>
<summary>export note review</summary>

Component: `NativeNoteExport`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![export note review at 390px](flow-updates/note-export-review-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![export note review at 320px](flow-updates/note-export-review-320.png)

</details>

<details>
<summary>export note shared authorization</summary>

Component: `NativeOperationAuthentication`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![export note shared authorization at 390px](flow-updates/note-export-auth-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![export note shared authorization at 320px](flow-updates/note-export-auth-320.png)

</details>

<details>
<summary>restore note review</summary>

Component: `NativeNoteRestore`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![restore note review at 390px](flow-updates/note-restore-review-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![restore note review at 320px](flow-updates/note-restore-review-320.png)

</details>

<details>
<summary>restore note shared authorization</summary>

Component: `NativeOperationAuthentication`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![restore note shared authorization at 390px](flow-updates/note-restore-auth-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![restore note shared authorization at 320px](flow-updates/note-restore-auth-320.png)

</details>

<details>
<summary>maintenance note review</summary>

Component: `NativeNoteMaintenance`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![maintenance note review at 390px](flow-updates/note-maintenance-review-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![maintenance note review at 320px](flow-updates/note-maintenance-review-320.png)

</details>

<details>
<summary>maintenance note shared authorization</summary>

Component: `NativeOperationAuthentication`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![maintenance note shared authorization at 390px](flow-updates/note-maintenance-auth-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![maintenance note shared authorization at 320px](flow-updates/note-maintenance-auth-320.png)

</details>

<details>
<summary>Sentry shared authorization</summary>

Component: `NativeOperationAuthentication`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Sentry shared authorization at 390px](flow-updates/sentry-auth-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Sentry shared authorization at 320px](flow-updates/sentry-auth-320.png)

</details>

<details>
<summary>Collateral release acknowledgement</summary>

Component: `NativeSentryNodes`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Collateral release acknowledgement at 390px](flow-updates/collateral-review-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Collateral release acknowledgement at 320px](flow-updates/collateral-review-320.png)

</details>

<details>
<summary>Collateral release shared authorization</summary>

Component: `NativeOperationAuthentication`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Collateral release shared authorization at 390px](flow-updates/collateral-auth-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Collateral release shared authorization at 320px](flow-updates/collateral-auth-320.png)

</details>

<details>
<summary>Restored note prerequisite review</summary>

Component: `NativePrivateWithdrawal`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Restored note prerequisite review at 390px](flow-updates/restored-note-review-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Restored note prerequisite review at 320px](flow-updates/restored-note-review-320.png)

</details>

<details>
<summary>Restored note shared authorization</summary>

Component: `NativeOperationAuthentication`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Restored note shared authorization at 390px](flow-updates/restored-note-auth-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Restored note shared authorization at 320px](flow-updates/restored-note-auth-320.png)

</details>

<details>
<summary>Dapp erc20 primary transfer review</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Dapp erc20 primary transfer review at 390px](flow-updates/dapp-erc20-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc20 primary transfer review at 320px](flow-updates/dapp-erc20-320.png)

</details>

<details>
<summary>Dapp erc721 primary transfer review</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Dapp erc721 primary transfer review at 390px](flow-updates/dapp-erc721-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc721 primary transfer review at 320px](flow-updates/dapp-erc721-320.png)

</details>

<details>
<summary>Dapp erc1155 primary transfer review</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 390px.

![Dapp erc1155 primary transfer review at 390px](flow-updates/dapp-erc1155-390.png)

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc1155 primary transfer review at 320px](flow-updates/dapp-erc1155-320.png)

</details>

<details>
<summary>Private note before shared authorization</summary>

Component: `NativeNoteReveal`.

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 390px.

![Private note before shared authorization at 390px](flow-updates/note-reveal-review-390.png)

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 320px.

![Private note before shared authorization at 320px](flow-updates/note-reveal-review-320.png)

</details>

<details>
<summary>Shared authorization for note reveal</summary>

Component: `NativeOperationAuthentication`.

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 390px.

![Shared authorization for note reveal at 390px](flow-updates/note-reveal-auth-390.png)

Source: `ab9c46267ab1cb8124d8a17f7d5ba2b6cb95a065` · 320px.

![Shared authorization for note reveal at 320px](flow-updates/note-reveal-auth-320.png)

</details>

<details>
<summary>Dapp erc20 recipient and fee review</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc20 recipient and fee review at 320px](flow-updates/dapp-erc20-details-320.png)

</details>

<details>
<summary>Transaction copy remains disabled while pending</summary>

Component: `UtxoActivityScreen / TransactionDetailLayout`.

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 390px.

![Transaction copy remains disabled while pending at 390px](flow-updates/utxo-copy-pending-390.png)

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 320px.

![Transaction copy remains disabled while pending at 320px](flow-updates/utxo-copy-pending-320.png)

</details>

<details>
<summary>Recovery phrase before verification</summary>

Component: `NativeRecovery`.

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 390px.

![Recovery phrase before verification at 390px](flow-updates/recovery-phrase-390.png)

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 320px.

![Recovery phrase before verification at 320px](flow-updates/recovery-phrase-320.png)

</details>

<details>
<summary>Verified wallet before new PIN</summary>

Component: `NativeRecovery`.

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 390px.

![Verified wallet before new PIN at 390px](flow-updates/recovery-verified-390.png)

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 320px.

![Verified wallet before new PIN at 320px](flow-updates/recovery-verified-320.png)

</details>

<details>
<summary>Create new PIN after verification</summary>

Component: `NativeRecovery / PinSetup`.

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 390px.

![Create new PIN after verification at 390px](flow-updates/recovery-new-pin-390.png)

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 320px.

![Create new PIN after verification at 320px](flow-updates/recovery-new-pin-320.png)

</details>

<details>
<summary>Confirm replacement PIN</summary>

Component: `NativeRecovery / PinSetup`.

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 390px.

![Confirm replacement PIN at 390px](flow-updates/recovery-confirm-pin-390.png)

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 320px.

![Confirm replacement PIN at 320px](flow-updates/recovery-confirm-pin-320.png)

</details>

<details>
<summary>Recovery complete: unlock with the new PIN</summary>

Component: `NativeWallet / PinEntryScreen`.

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 390px.

![Recovery complete: unlock with the new PIN at 390px](flow-updates/recovery-complete-390.png)

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 320px.

![Recovery complete: unlock with the new PIN at 320px](flow-updates/recovery-complete-320.png)

</details>

<details>
<summary>Recovery interrupted: possible completion notice</summary>

Component: `NativeWallet / PinEntryScreen`.

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 390px.

![Recovery interrupted: possible completion notice at 390px](flow-updates/recovery-interrupted-390.png)

Source: `ca14d91409defadcd45f0cd044cf3eccae02cada` · 320px.

![Recovery interrupted: possible completion notice at 320px](flow-updates/recovery-interrupted-320.png)

</details>

<details>
<summary>Dapp erc721 full recipient and token contract</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc721 full recipient and token contract at 320px](flow-updates/dapp-erc721-recipient-320.png)

</details>

<details>
<summary>Dapp erc721 token contract, owner and fee review</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc721 token contract, owner and fee review at 320px](flow-updates/dapp-erc721-details-320.png)

</details>

<details>
<summary>Dapp erc1155 full recipient and token contract</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc1155 full recipient and token contract at 320px](flow-updates/dapp-erc1155-recipient-320.png)

</details>

<details>
<summary>Dapp erc1155 token contract, owner and fee review</summary>

Component: `NativeTransactionReviewScreen`.

Source: `a7c370a22656574043007ccc8d15fe2af342351a` · 320px.

![Dapp erc1155 token contract, owner and fee review at 320px](flow-updates/dapp-erc1155-details-320.png)

</details>

<!-- current-flow-updates:end -->


<!-- selected-account-overview-updates:start -->
Notification states were refreshed at `20e9ad763ffa74abb620dc8ee6da30b3242d671d`; see [coverage and Saved pending capture provenance](saved-pending-updates/manifest.json). Other earlier frames retain their recorded source revisions.


## Selected account, Send, Activity and alert updates

Source: `b85f64614c047f7778345097b0c3d983479db1e3`. [Per-frame and exported-bundle provenance](account-updates/manifest.json). Primary implementation panels 09, 10 and 18 above are current; their original PDF/video reference panels are preserved.

Actual React Native Web components with synthetic public fixtures. External network blocked. Native-device, funded-transaction, hardware and OS notification delivery qualification are separate.

<details>
<summary>Account 1 · All added EVM networks — 390px</summary>

![Account 1 · All added EVM networks](account-updates/overview-all-390.png)

Open account 1 → No saved filter: All networks.

</details>

<details>
<summary>Network-only Send from — 390px</summary>

![Network-only Send from](account-updates/send-from-390.png)

All networks → Tap Send.

</details>

<details>
<summary>Account 1 · Ethereum only — 390px</summary>

![Account 1 · Ethereum only](account-updates/overview-ethereum-390.png)

Choose Ethereum filter; no hidden-network or sibling-account reads.

</details>

<details>
<summary>Account 15 · same Ethereum filter — 390px</summary>

![Account 15 · same Ethereum filter](account-updates/overview-account15-390.png)

Choose another account → Retain Ethereum filter.

</details>

<details>
<summary>Search saved assets on Ethereum — 390px</summary>

![Search saved assets on Ethereum](account-updates/asset-picker-390.png)

Known Ethereum send form → Open asset picker → Search USDC.

</details>

<details>
<summary>Selected-account activity across networks — 390px</summary>

![Selected-account activity across networks](account-updates/activity-all-390.png)

All networks activity → Newest first with exact network badges.

</details>

<details>
<summary>Activity network filter — 390px</summary>

![Activity network filter](account-updates/activity-network-picker-390.png)

Open the Activity network filter → Packaged network logos beside each added network.

</details>

<details>
<summary>Ethereum activity only — 390px</summary>

![Ethereum activity only](account-updates/activity-ethereum-390.png)

Choose Ethereum → Selected filter and activity badges keep network logos.

</details>

<details>
<summary>Explicit activity alert enrollment — 390px</summary>

![Explicit activity alert enrollment](account-updates/notifications-all-390.png)

Settings → Activity alerts.

</details>

<details>
<summary>Search alert enrollment — 390px</summary>

![Search alert enrollment](account-updates/notifications-filtered-390.png)

Search Ethereum → No permission request until enabling a row.

</details>

<details>
<summary>Account 1 · All added EVM networks — 320px</summary>

![Account 1 · All added EVM networks](account-updates/overview-all-320.png)

Open account 1 → No saved filter: All networks.

</details>

<details>
<summary>Network-only Send from — 320px</summary>

![Network-only Send from](account-updates/send-from-320.png)

All networks → Tap Send.

</details>

<details>
<summary>Account 1 · Ethereum only — 320px</summary>

![Account 1 · Ethereum only](account-updates/overview-ethereum-320.png)

Choose Ethereum filter; no hidden-network or sibling-account reads.

</details>

<details>
<summary>Account 15 · same Ethereum filter — 320px</summary>

![Account 15 · same Ethereum filter](account-updates/overview-account15-320.png)

Choose another account → Retain Ethereum filter.

</details>

<details>
<summary>Search saved assets on Ethereum — 320px</summary>

![Search saved assets on Ethereum](account-updates/asset-picker-320.png)

Known Ethereum send form → Open asset picker → Search USDC.

</details>

<details>
<summary>Selected-account activity across networks — 320px</summary>

![Selected-account activity across networks](account-updates/activity-all-320.png)

All networks activity → Newest first with exact network badges.

</details>

<details>
<summary>Activity network filter — 320px</summary>

![Activity network filter](account-updates/activity-network-picker-320.png)

Open the Activity network filter → Packaged network logos beside each added network.

</details>

<details>
<summary>Ethereum activity only — 320px</summary>

![Ethereum activity only](account-updates/activity-ethereum-320.png)

Choose Ethereum → Selected filter and activity badges keep network logos.

</details>

<details>
<summary>Explicit activity alert enrollment — 320px</summary>

![Explicit activity alert enrollment](account-updates/notifications-all-320.png)

Settings → Activity alerts.

</details>

<details>
<summary>Search alert enrollment — 320px</summary>

![Search alert enrollment](account-updates/notifications-filtered-320.png)

Search Ethereum → No permission request until enabling a row.

</details>

<!-- selected-account-overview-updates:end -->

<!-- saved-pending-updates:start -->

## Saved pending and notification coverage

Source: `20e9ad763ffa74abb620dc8ee6da30b3242d671d`. [Per-frame provenance](saved-pending-updates/manifest.json). Saved pending pages the existing local journal for one selected-account network. A concrete Activity filter enters directly; All networks first chooses a visible network. Detail and inventory Back return to the prior aggregate scroll position.

<details>
<summary>Saved pending · choose a network — 390px</summary>

![Saved pending · choose a network](saved-pending-updates/saved-network-picker-390.png)

Activity options → Saved pending → Only the selected account and visible networks.

</details>

<details>
<summary>Saved pending · Base inventory — 390px</summary>

![Saved pending · Base inventory](saved-pending-updates/saved-inventory-390.png)

Choose Base → Older local journal row outside recent history → Existing pagination and detail actions.

</details>

<details>
<summary>Activity alerts · supported coverage — 390px</summary>

![Activity alerts · supported coverage](saved-pending-updates/notifications-all-390.png)

Explicit enrollment only → Unsupported transaction networks labelled and disabled.

</details>

<details>
<summary>Activity alerts · filtered Ethereum — 390px</summary>

![Activity alerts · filtered Ethereum](saved-pending-updates/notifications-filtered-390.png)

Search Ethereum → Existing enrollment remains removable.

</details>

<details>
<summary>Saved pending · choose a network — 320px</summary>

![Saved pending · choose a network](saved-pending-updates/saved-network-picker-320.png)

Activity options → Saved pending → Only the selected account and visible networks.

</details>

<details>
<summary>Saved pending · Base inventory — 320px</summary>

![Saved pending · Base inventory](saved-pending-updates/saved-inventory-320.png)

Choose Base → Older local journal row outside recent history → Existing pagination and detail actions.

</details>

<details>
<summary>Activity alerts · supported coverage — 320px</summary>

![Activity alerts · supported coverage](saved-pending-updates/notifications-all-320.png)

Explicit enrollment only → Unsupported transaction networks labelled and disabled.

</details>

<details>
<summary>Activity alerts · filtered Ethereum — 320px</summary>

![Activity alerts · filtered Ethereum](saved-pending-updates/notifications-filtered-320.png)

Search Ethereum → Existing enrollment remains removable.

</details>

<!-- saved-pending-updates:end -->

<!-- consent-updates:start -->

## Latest consent review

Source `dff877f472192f1597112d7c8ca154355fbf3a3f`. [Exact capture provenance](consent-updates/manifest.json). The existing transaction-request comparison and transfer/Sentry panels above are updated in place. These public fixtures verify presentation at 390px and 320px; native biometric and hardware qualification remain separate.

<details>
<summary>Smart-account token transfer</summary>

![Smart-account token transfer at 390px](consent-updates/smart-token-390.png)

![Smart-account token transfer at 320px](consent-updates/smart-token-320.png)

</details>

<details>
<summary>Smart-account mixed batch</summary>

![Smart-account mixed batch at 390px](consent-updates/smart-batch-390.png)

![Smart-account mixed batch at 320px](consent-updates/smart-batch-320.png)

</details>

<details>
<summary>Configured bridged USDC icon</summary>

![Configured bridged USDC icon at 390px](consent-updates/known-usdc-390.png)

![Configured bridged USDC icon at 320px](consent-updates/known-usdc-320.png)

</details>

<details>
<summary>Configured SYSX icon</summary>

![Configured SYSX icon at 390px](consent-updates/known-sysx-390.png)

![Configured SYSX icon at 320px](consent-updates/known-sysx-320.png)

</details>

<!-- consent-updates:end -->
