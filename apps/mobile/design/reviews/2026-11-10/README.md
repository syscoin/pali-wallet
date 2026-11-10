# Pali mobile screen review — 10 November 2026

All 32 PDF reference states are compared below with screenshots of the **actual implemented React Native components**. Home, Send, Receive and Activity also include frames from the supplied video. Each image opens at full size; each row has a 320-pixel capture for narrow-screen review.

**Core source:** `d7534eca79309277cf2a1df927f8b56d5f655fb6`. Welcome was refined against the reference at `812e76dd6faf0bf035814c6da8fe4f6d079efda4`; its fresh normal/narrow captures and hashes are included. Captures use public synthetic wallet/network/connection adapters in a browser at 390×844 and 320×568. They are UI evidence, not native-device, biometric, camera or funded-transaction qualification. Recovery words shown are a publicly known test phrase. No real wallet data is included.

**Implemented authentication:** sends now require transaction-bound password or enabled device-biometric confirmation; the gallery shows the password fallback. Browser adapters cannot demonstrate the OS biometric prompt. **Remaining design difference:** the current vault still uses a password, so pages 2–4 and 7 retain password setup; the proposed PIN-only architecture is not implemented. Page 28 honestly shows the browser fallback for the native camera. Other adaptations are identified per screen.

[Additional implemented features outside the PDF](#additional-implemented-screens-without-pdf-references) · [Removal with a confirmed backup](actual/actual-26-backed-up.png) · [Confirmed-backup removal at 320 px](actual/actual-26-backed-up-320.png)

[Open all-screen contact sheet](contact-sheet.png) · [Capture manifest and hashes](manifest.json)

| PDF page | Comparison | Narrow actual capture | Status |
| --- | --- | --- | --- |
| 01 | [Welcome](01-welcome.png) | [320 px](actual/actual-01-320.png) | implemented |
| 02 | [Create PIN](02-create-pin.png) | [320 px](actual/actual-02-320.png) | adapted |
| 03 | [Confirm PIN](03-confirm-pin.png) | [320 px](actual/actual-03-320.png) | adapted |
| 04 | [Fingerprint](04-fingerprint.png) | [320 px](actual/actual-04-320.png) | adapted |
| 05 | [Import wallet](05-import-wallet.png) | [320 px](actual/actual-05-320.png) | implemented |
| 06 | [Confirm restored wallet](06-confirm-restored-wallet.png) | [320 px](actual/actual-06-320.png) | implemented |
| 07 | [Locked](07-locked.png) | [320 px](actual/actual-07-320.png) | adapted |
| 08 | [Recover access](08-recover-access.png) | [320 px](actual/actual-08-320.png) | adapted |
| 09 | [Wallet Home](09-wallet-home.png) | [320 px](actual/actual-09-320.png) | adapted |
| 10 | [Choose Send network](10-choose-send-network.png) | [320 px](actual/actual-10-320.png) | adapted |
| 11 | [Send details](11-send-details.png) | [320 px](actual/actual-11-320.png) | implemented |
| 12 | [Review Send](12-review-send.png) | [320 px](actual/actual-12-320.png) | adapted |
| 13 | [Authorize Send](13-authorize-send.png) | [320 px](actual/actual-13-320.png) | adapted |
| 14 | [Send submitted](14-send-submitted.png) | [320 px](actual/actual-14-320.png) | implemented |
| 15 | [Choose Receive network](15-choose-receive-network.png) | [320 px](actual/actual-15-320.png) | adapted |
| 16 | [Receive backup warning](16-receive-backup-warning.png) | [320 px](actual/actual-16-320.png) | implemented |
| 17 | [Receive](17-receive.png) | [320 px](actual/actual-17-320.png) | implemented |
| 18 | [Activity](18-activity.png) | [320 px](actual/actual-18-320.png) | adapted |
| 19 | [Transaction details](19-transaction-details.png) | [320 px](actual/actual-19-320.png) | adapted |
| 20 | [Backup introduction](20-backup-introduction.png) | [320 px](actual/actual-20-320.png) | implemented |
| 21 | [Recovery phrase](21-recovery-phrase.png) | [320 px](actual/actual-21-320.png) | implemented |
| 22 | [Verify backup](22-verify-backup.png) | [320 px](actual/actual-22-320.png) | adapted |
| 23 | [Backup complete](23-backup-complete.png) | [320 px](actual/actual-23-320.png) | implemented |
| 24 | [Settings](24-settings.png) | [320 px](actual/actual-24-320.png) | adapted |
| 25 | [Security](25-security.png) | [320 px](actual/actual-25-320.png) | adapted |
| 26 | [Remove wallet](26-remove-wallet.png) | [320 px](actual/actual-26-320.png) | adapted |
| 27 | [WalletConnect](27-walletconnect.png) | [320 px](actual/actual-27-320.png) | implemented |
| 28 | [Scan WalletConnect QR](28-scan-walletconnect-qr.png) | [320 px](actual/actual-28-320.png) | native-only |
| 29 | [Pairing preview](29-pairing-preview.png) | [320 px](actual/actual-29-320.png) | adapted |
| 30 | [Connection request](30-connection-request.png) | [320 px](actual/actual-30-320.png) | adapted |
| 31 | [Connected app details](31-connected-app-details.png) | [320 px](actual/actual-31-320.png) | implemented |
| 32 | [Transaction request](32-transaction-request.png) | [320 px](actual/actual-32-320.png) | adapted |

<details>
<summary>01. Welcome — implemented</summary>

Welcome glow, dot falloff, logo placement and title weight were measured against the reference. The direct Create/Import/Watch actions remain unchanged.

![Welcome: reference and implemented screen](01-welcome.png)

[Actual 390 px](actual/actual-01.png) · [Actual 320 px](actual/actual-01-320.png)

Component: `Onboarding.Welcome`

</details>

<details>
<summary>02. Create PIN — adapted</summary>

The existing password-encrypted vault is retained. This is a password form, not a PIN keypad; a PIN-only/OS-protected custody redesign is not claimed.

![Create PIN: reference and implemented screen](02-create-pin.png)

[Actual 390 px](actual/actual-02.png) · [Actual 320 px](actual/actual-02-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>03. Confirm PIN — adapted</summary>

Password confirmation remains on the same form. A separate PIN route is not implemented.

![Confirm PIN: reference and implemented screen](03-confirm-pin.png)

[Actual 390 px](actual/actual-03.png) · [Actual 320 px](actual/actual-03-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>04. Fingerprint — adapted</summary>

Real optional biometric enrollment control on the security form. This browser uses a public test adapter; no physical biometric prompt is claimed.

![Fingerprint: reference and implemented screen](04-fingerprint.png)

[Actual 390 px](actual/actual-04.png) · [Actual 320 px](actual/actual-04-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>05. Import wallet — implemented</summary>

Numbered 12/24-word entry. Phrase verification uses the existing shared SDK; no automatic clipboard read.

![Import wallet: reference and implemented screen](05-import-wallet.png)

[Actual 390 px](actual/actual-05.png) · [Actual 320 px](actual/actual-05-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>06. Confirm restored wallet — implemented</summary>

Public address preview precedes security setup. This fixture displays a public synthetic EVM address; the production preview uses shared EVM/UTXO derivation.

![Confirm restored wallet: reference and implemented screen](06-confirm-restored-wallet.png)

[Actual 390 px](actual/actual-06.png) · [Actual 320 px](actual/actual-06-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>07. Locked — adapted</summary>

Branded locked state with biometric entry and wallet-password fallback. The current password architecture is retained rather than changing the vault to PIN encryption.

![Locked: reference and implemented screen](07-locked.png)

[Actual 390 px](actual/actual-07.png) · [Actual 320 px](actual/actual-07-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>08. Recover access — adapted</summary>

Recovery remains an explicit, protected existing flow. Recovery phrase verification authorizes changing local access; imported keys and notes require their independent recovery material.

![Recover access: reference and implemented screen](08-recover-access.png)

[Actual 390 px](actual/actual-08.png) · [Actual 320 px](actual/actual-08-320.png)

Component: `NativeRecovery`

</details>

<details>
<summary>09. Wallet Home — adapted</summary>

Pali branding without a root Back arrow; compact amount with exact accessible value and asset detail; Send/Receive, asset list, and Import token. Balance follows the selected network.

![Wallet Home: reference and implemented screen](09-wallet-home.png)

[Actual 390 px](actual/actual-09.png) · [Actual 320 px](actual/actual-09-320.png)

Component: `NativePortfolio + NativeTokens + RealAppShell`

</details>

<details>
<summary>10. Choose Send network — adapted</summary>

Existing shared network picker; no separate Send-only network screen.

![Choose Send network: reference and implemented screen](10-choose-send-network.png)

[Actual 390 px](actual/actual-10.png) · [Actual 320 px](actual/actual-10-320.png)

Component: `NativeNetworks`

</details>

<details>
<summary>11. Send details — implemented</summary>

Selected-network badge and in-field recipient scanner. Exact amounts and advanced nonce behavior retained.

![Send details: reference and implemented screen](11-send-details.png)

[Actual 390 px](actual/actual-11.png) · [Actual 320 px](actual/actual-11-320.png)

Component: `NativeSend`

</details>

<details>
<summary>12. Review Send — adapted</summary>

One primary action; Header Back edits. Exact recipient, amount and maximum execution fee remain visible.

![Review Send: reference and implemented screen](12-review-send.png)

[Actual 390 px](actual/actual-12.png) · [Actual 320 px](actual/actual-12-320.png)

Component: `NativeSend`

</details>

<details>
<summary>13. Authorize Send — adapted</summary>

Implemented transaction-bound password/biometric authentication, with stale-review checks and retryable credential refusal. This capture shows the actual password fallback, not a native biometric prompt.

![Authorize Send: reference and implemented screen](13-authorize-send.png)

[Actual 390 px](actual/actual-13.png) · [Actual 320 px](actual/actual-13-320.png)

Component: `NativeSend`

</details>

<details>
<summary>14. Send submitted — implemented</summary>

Checkmark and Done; known submitted outcomes offer the parent-provided View transaction action. Uncertain submission keeps explicit status/retry controls.

![Send submitted: reference and implemented screen](14-send-submitted.png)

[Actual 390 px](actual/actual-14.png) · [Actual 320 px](actual/actual-14-320.png)

Component: `NativeSend`

</details>

<details>
<summary>15. Choose Receive network — adapted</summary>

Same shared network picker as Send; selected network determines the receive address.

![Choose Receive network: reference and implemented screen](15-choose-receive-network.png)

[Actual 390 px](actual/actual-15.png) · [Actual 320 px](actual/actual-15-320.png)

Component: `NativeNetworks`

</details>

<details>
<summary>16. Receive backup warning — implemented</summary>

Bottom sheet over dimmed Home with Back Up Now and Receive Anyway. Acknowledgement is bound to the current account/network and is cleared on departure.

![Receive backup warning: reference and implemented screen](16-receive-backup-warning.png)

[Actual 390 px](actual/actual-16.png) · [Actual 320 px](actual/actual-16-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>17. Receive — implemented</summary>

Actual address, generated QR and Copy/Share actions for the selected account and network.

![Receive: reference and implemented screen](17-receive.png)

[Actual 390 px](actual/actual-17.png) · [Actual 320 px](actual/actual-17-320.png)

Component: `NativePortfolio`

</details>

<details>
<summary>18. Activity — adapted</summary>

Approved compact header and filter layout with dated transaction rows. Full values and identifiers remain available in details.

![Activity: reference and implemented screen](18-activity.png)

[Actual 390 px](actual/actual-18.png) · [Actual 320 px](actual/actual-18-320.png)

Component: `NativeActivityScreen + ActivityListRow`

</details>

<details>
<summary>19. Transaction details — adapted</summary>

Centered status and amount with compact facts and expandable technical detail; real observation and error semantics retained.

![Transaction details: reference and implemented screen](19-transaction-details.png)

[Actual 390 px](actual/actual-19.png) · [Actual 320 px](actual/actual-19-320.png)

Component: `NativeActivityScreen`

</details>

<details>
<summary>20. Backup introduction — implemented</summary>

Shield hero, three concise steps and fixed Back Up Now / Do It Later. Phrase access is authenticated after this introduction.

![Backup introduction: reference and implemented screen](20-backup-introduction.png)

[Actual 390 px](actual/actual-20.png) · [Actual 320 px](actual/actual-20-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>21. Recovery phrase — implemented</summary>

Numbered words, privacy warning and acknowledgement. Public known test phrase only.

![Recovery phrase: reference and implemented screen](21-recovery-phrase.png)

[Actual 390 px](actual/actual-21.png) · [Actual 320 px](actual/actual-21-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>22. Verify backup — adapted</summary>

Per user direction the quiz is removed. This checked acknowledgement completes the current protected presentation; it does not claim to prove an external backup.

![Verify backup: reference and implemented screen](22-verify-backup.png)

[Actual 390 px](actual/actual-22.png) · [Actual 320 px](actual/actual-22-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>23. Backup complete — implemented</summary>

Centered success state, one Done action, no redundant Back control.

![Backup complete: reference and implemented screen](23-backup-complete.png)

[Actual 390 px](actual/actual-23.png) · [Actual 320 px](actual/actual-23-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>24. Settings — adapted</summary>

Root tab without Back. The backup badge is conditional on backup status; unconfirmed state is also included in the extra gallery.

![Settings: reference and implemented screen](24-settings.png)

[Actual 390 px](actual/actual-24.png) · [Actual 320 px](actual/actual-24-320.png)

Component: `RealSettings`

</details>

<details>
<summary>25. Security — adapted</summary>

Compact recovery status, biometric settings, Auto-lock and actual persistent Privacy mode. Change PIN is not fabricated while the vault still uses a password.

![Security: reference and implemented screen](25-security.png)

[Actual 390 px](actual/actual-25.png) · [Actual 320 px](actual/actual-25-320.png)

Component: `NativeSecurity`

</details>

<details>
<summary>26. Remove wallet — adapted</summary>

Reference-style destructive review with bottom actions and conditional red backup warning. The countdown is removed from presentation; expiry and authorization remain enforced. Confirmed-backup variant is linked separately.

![Remove wallet: reference and implemented screen](26-remove-wallet.png)

[Actual 390 px](actual/actual-26.png) · [Actual 320 px](actual/actual-26-320.png)

Component: `NativeWalletRemovalScreen`

</details>

<details>
<summary>27. WalletConnect — implemented</summary>

Compact connection entry, explicit Scan/Paste and always-visible Active connections list. Clipboard is read only on tap.

![WalletConnect: reference and implemented screen](27-walletconnect.png)

[Actual 390 px](actual/actual-27.png) · [Actual 320 px](actual/actual-27-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>28. Scan WalletConnect QR — native-only</summary>

Shared actual scanner; camera is native-only. Browser capture honestly shows the fallback, not a simulated camera view.

![Scan WalletConnect QR: reference and implemented screen](28-scan-walletconnect-qr.png)

[Actual 390 px](actual/actual-28.png) · [Actual 320 px](actual/actual-28-320.png)

Component: `ConnectionQrScanner.web`

</details>

<details>
<summary>29. Pairing preview — adapted</summary>

Spinner, selected network and authoritative expiry; no invented app identity before its proposal. Pairing does not grant account access.

![Pairing preview: reference and implemented screen](29-pairing-preview.png)

[Actual 390 px](actual/actual-29.png) · [Actual 320 px](actual/actual-29-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>30. Connection request — adapted</summary>

App identity, verified-origin status, account/network, permission icons and real expiry. Displayed permissions use the same selection as the actual grant. Fixed Reject/Connect actions.

![Connection request: reference and implemented screen](30-connection-request.png)

[Actual 390 px](actual/actual-30.png) · [Actual 320 px](actual/actual-30-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>31. Connected app details — implemented</summary>

Isolated app detail with network, account, permissions, expiry and bottom Disconnect. Last-used is omitted because the wallet has no authoritative measurement.

![Connected app details: reference and implemented screen](31-connected-app-details.png)

[Actual 390 px](actual/actual-31.png) · [Actual 320 px](actual/actual-31-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>32. Transaction request — adapted</summary>

App identity, exact amount, compact From/To/network/maximum-fee facts and real Reject/Confirm buttons. All fee, phishing, account-switch and uncertain-delivery safeguards remain.

![Transaction request: reference and implemented screen](32-transaction-request.png)

[Actual 390 px](actual/actual-32.png) · [Actual 320 px](actual/actual-32-320.png)

Component: `NativeTransactionReviewScreen`

</details>


## Additional implemented screens without PDF references

60 feature states below have fresh captures at 390 and 320 pixels wide. These are the implemented components with public synthetic adapters. Per-capture source revisions, routes and loaded assets are recorded in the manifest; the additional fixture routes and final approval controls use source `065e1211cad2e84c3d21f618ba967452ac768e5a`. The market chart uses explicitly synthetic data.

[Overview 1](extras/contact-01.png) · [Overview 2](extras/contact-02.png) · [Overview 3](extras/contact-03.png) · [Overview 4](extras/contact-04.png) · [Overview 5](extras/contact-05.png) · [Capture provenance](extras/manifest.json)

<details>
<summary>Watch-only account — no PDF reference</summary>

Component: `App / RealPortfolio`.

![Watch-only account](extras/01-watch-wallet-390.png)

[390 px](extras/01-watch-wallet-390.png) · [320 px](extras/01-watch-wallet-320.png)

</details>

<details>
<summary>Native account manager — no PDF reference</summary>

Component: `NativeAccounts`.

![Native account manager](extras/02-account-manager-390.png)

[390 px](extras/02-account-manager-390.png) · [320 px](extras/02-account-manager-320.png)

</details>

<details>
<summary>Create another software account — no PDF reference</summary>

Component: `NativeAccounts`.

![Create another software account](extras/03-create-account-390.png)

[390 px](extras/03-create-account-390.png) · [320 px](extras/03-create-account-320.png)

</details>

<details>
<summary>Add a custom network — no PDF reference</summary>

Component: `NativeNetworks`.

![Add a custom network](extras/04-network-add-390.png)

[390 px](extras/04-network-add-390.png) · [320 px](extras/04-network-add-320.png)

</details>

<details>
<summary>Token assets — no PDF reference</summary>

Component: `NativePortfolio`.

![Token assets](extras/05-token-assets-390.png)

[390 px](extras/05-token-assets-390.png) · [320 px](extras/05-token-assets-320.png)

</details>

<details>
<summary>Import token / find holdings — no PDF reference</summary>

Component: `NativeTokens`.

![Import token / find holdings](extras/06-import-token-390.png)

[390 px](extras/06-import-token-390.png) · [320 px](extras/06-import-token-320.png)

</details>

<details>
<summary>Verified token preview — no PDF reference</summary>

Component: `NativeTokens`.

![Verified token preview](extras/07-token-review-390.png)

[390 px](extras/07-token-review-390.png) · [320 px](extras/07-token-review-320.png)

</details>

<details>
<summary>Collectible discovery — no PDF reference</summary>

Component: `NativeTokens`.

![Collectible discovery](extras/08-collectible-discovery-390.png)

[390 px](extras/08-collectible-discovery-390.png) · [320 px](extras/08-collectible-discovery-320.png)

</details>

<details>
<summary>Collectible ownership form — no PDF reference</summary>

Component: `NativeTokens / CollectibleOwnership`.

![Collectible ownership form](extras/09-collectible-ownership-390.png)

[390 px](extras/09-collectible-ownership-390.png) · [320 px](extras/09-collectible-ownership-320.png)

</details>

<details>
<summary>EVM advanced nonce — no PDF reference</summary>

Component: `NativeSend`.

![EVM advanced nonce](extras/10-evm-nonce-390.png)

[390 px](extras/10-evm-nonce-390.png) · [320 px](extras/10-evm-nonce-320.png)

</details>

<details>
<summary>UTXO advanced transaction options — no PDF reference</summary>

Component: `NativeUtxoSend`.

![UTXO advanced transaction options](extras/11-utxo-advanced-390.png)

[390 px](extras/11-utxo-advanced-390.png) · [320 px](extras/11-utxo-advanced-320.png)

</details>

<details>
<summary>ERC-20 transfer form — no PDF reference</summary>

Component: `NativeSend`.

![ERC-20 transfer form](extras/12-erc20-send-390.png)

[390 px](extras/12-erc20-send-390.png) · [320 px](extras/12-erc20-send-320.png)

</details>

<details>
<summary>Guardian policy and status — no PDF reference</summary>

Component: `NativeGuardianPolicy`.

![Guardian policy and status](extras/14-guardian-policy-390.png)

[390 px](extras/14-guardian-policy-390.png) · [320 px](extras/14-guardian-policy-320.png)

</details>

<details>
<summary>Guardian policy editor — no PDF reference</summary>

Component: `NativeGuardianPolicy`.

![Guardian policy editor](extras/15-guardian-policy-edit-390.png)

[390 px](extras/15-guardian-policy-edit-390.png) · [320 px](extras/15-guardian-policy-edit-320.png)

</details>

<details>
<summary>Smart guardian / separate payer recovery — no PDF reference</summary>

Component: `NativeGuardianRecovery`.

![Smart guardian / separate payer recovery](extras/16-smart-guardian-recovery-390.png)

[390 px](extras/16-smart-guardian-recovery-390.png) · [320 px](extras/16-smart-guardian-recovery-320.png)

</details>

<details>
<summary>Guardian recovery proof review — no PDF reference</summary>

Component: `NativeGuardianRecovery`.

![Guardian recovery proof review](extras/17-guardian-recovery-review-390.png)

[390 px](extras/17-guardian-recovery-review-390.png) · [320 px](extras/17-guardian-recovery-review-320.png)

</details>

<details>
<summary>SLH-DSA prepared keys — no PDF reference</summary>

Component: `NativeSlhDsaManagement`.

![SLH-DSA prepared keys](extras/18-slh-keys-390.png)

[390 px](extras/18-slh-keys-390.png) · [320 px](extras/18-slh-keys-320.png)

</details>

<details>
<summary>SLH-DSA installed keys — no PDF reference</summary>

Component: `NativeSlhDsaManagement`.

![SLH-DSA installed keys](extras/19-slh-installed-390.png)

[390 px](extras/19-slh-installed-390.png) · [320 px](extras/19-slh-installed-320.png)

</details>

<details>
<summary>Smart account transfer — no PDF reference</summary>

Component: `NativeSmartAccountSend`.

![Smart account transfer](extras/20-smart-transfer-390.png)

[390 px](extras/20-smart-transfer-390.png) · [320 px](extras/20-smart-transfer-320.png)

</details>

<details>
<summary>Smart account deployment authorization — no PDF reference</summary>

Component: `NativeSmartAccountOperation`.

![Smart account deployment authorization](extras/21-smart-deployment-390.png)

[390 px](extras/21-smart-deployment-390.png) · [320 px](extras/21-smart-deployment-320.png)

</details>

<details>
<summary>Smart account batched calls — no PDF reference</summary>

Component: `NativeSmartTransactionReview`.

![Smart account batched calls](extras/22-smart-batch-390.png)

[390 px](extras/22-smart-batch-390.png) · [320 px](extras/22-smart-batch-320.png)

</details>

<details>
<summary>Software account batched calls — no PDF reference</summary>

Component: `NativeTransactionReview`.

![Software account batched calls](extras/23-eoa-batch-390.png)

[390 px](extras/23-eoa-batch-390.png) · [320 px](extras/23-eoa-batch-320.png)

</details>

<details>
<summary>Private deposit form — no PDF reference</summary>

Component: `NativePrivateDeposit`.

![Private deposit form](extras/24-private-deposit-390.png)

[390 px](extras/24-private-deposit-390.png) · [320 px](extras/24-private-deposit-320.png)

</details>

<details>
<summary>Private deposit review — no PDF reference</summary>

Component: `NativePrivateDeposit`.

![Private deposit review](extras/25-private-deposit-review-390.png)

[390 px](extras/25-private-deposit-review-390.png) · [320 px](extras/25-private-deposit-review-320.png)

</details>

<details>
<summary>Private note inventory — no PDF reference</summary>

Component: `NativeNoteInventory`.

![Private note inventory](extras/26-private-notes-390.png)

[390 px](extras/26-private-notes-390.png) · [320 px](extras/26-private-notes-320.png)

</details>

<details>
<summary>Private withdrawal form — no PDF reference</summary>

Component: `NativePrivateWithdrawal`.

![Private withdrawal form](extras/27-private-withdrawal-390.png)

[390 px](extras/27-private-withdrawal-390.png) · [320 px](extras/27-private-withdrawal-320.png)

</details>

<details>
<summary>Import private note — no PDF reference</summary>

Component: `NativeNoteImport`.

![Import private note](extras/28-import-note-390.png)

[390 px](extras/28-import-note-390.png) · [320 px](extras/28-import-note-320.png)

</details>

<details>
<summary>Sentry key management — no PDF reference</summary>

Component: `NativeSentryKeys`.

![Sentry key management](extras/29-sentry-keys-390.png)

[390 px](extras/29-sentry-keys-390.png) · [320 px](extras/29-sentry-keys-320.png)

</details>

<details>
<summary>Sentry service settings — no PDF reference</summary>

Component: `NativeSentrySettings`.

![Sentry service settings](extras/30-sentry-service-390.png)

[390 px](extras/30-sentry-service-390.png) · [320 px](extras/30-sentry-service-320.png)

</details>

<details>
<summary>Sentry nodes — no PDF reference</summary>

Component: `NativeSentryNodes`.

![Sentry nodes](extras/31-sentry-nodes-390.png)

[390 px](extras/31-sentry-nodes-390.png) · [320 px](extras/31-sentry-nodes-320.png)

</details>

<details>
<summary>Ledger account review — no PDF reference</summary>

Component: `NativeLedger`.

![Ledger account review](extras/34-ledger-account-390.png)

[390 px](extras/34-ledger-account-390.png) · [320 px](extras/34-ledger-account-320.png)

</details>

<details>
<summary>Trezor account import — no PDF reference</summary>

Component: `NativeTrezor`.

![Trezor account import](extras/35-trezor-import-390.png)

[390 px](extras/35-trezor-import-390.png) · [320 px](extras/35-trezor-import-320.png)

</details>

<details>
<summary>Trezor Smart owner continuation — no PDF reference</summary>

Component: `NativeTrezorResumeNotice`.

![Trezor Smart owner continuation](extras/36-trezor-smart-resume-390.png)

[390 px](extras/36-trezor-smart-resume-390.png) · [320 px](extras/36-trezor-smart-resume-320.png)

</details>

<details>
<summary>Auto-lock preferences — no PDF reference</summary>

Component: `AutoLockSettings`.

![Auto-lock preferences](extras/39-auto-lock-390.png)

[390 px](extras/39-auto-lock-390.png) · [320 px](extras/39-auto-lock-320.png)

</details>

<details>
<summary>Biometric enrollment settings — no PDF reference</summary>

Component: `NativeWallet.native (device-unlock stage)`.

![Biometric enrollment settings](extras/40-biometric-settings-390.png)

[390 px](extras/40-biometric-settings-390.png) · [320 px](extras/40-biometric-settings-320.png)

</details>

<details>
<summary>Import software private key — no PDF reference</summary>

Component: `NativeImport`.

![Import software private key](extras/41-import-private-key-390.png)

[390 px](extras/41-import-private-key-390.png) · [320 px](extras/41-import-private-key-320.png)

</details>

<details>
<summary>Display currency preferences — no PDF reference</summary>

Component: `DisplayCurrency`.

![Display currency preferences](extras/42-display-currency-390.png)

[390 px](extras/42-display-currency-390.png) · [320 px](extras/42-display-currency-320.png)

</details>

<details>
<summary>Language preferences — no PDF reference</summary>

Component: `NativePreferences`.

![Language preferences](extras/43-languages-390.png)

[390 px](extras/43-languages-390.png) · [320 px](extras/43-languages-320.png)

</details>

<details>
<summary>Help and about — no PDF reference</summary>

Component: `HelpAbout`.

![Help and about](extras/44-help-about-390.png)

[390 px](extras/44-help-about-390.png) · [320 px](extras/44-help-about-320.png)

</details>

<details>
<summary>Private-key reveal authorization — no PDF reference</summary>

Component: `NativeSecurity`.

![Private-key reveal authorization](extras/45-private-key-auth-390.png)

[390 px](extras/45-private-key-auth-390.png) · [320 px](extras/45-private-key-auth-320.png)

</details>

<details>
<summary>Add public watch account — no PDF reference</summary>

Component: `Onboarding / AddWatchAccount`.

![Add public watch account](extras/46-watch-address-form-390.png)

[390 px](extras/46-watch-address-form-390.png) · [320 px](extras/46-watch-address-form-320.png)

</details>

<details>
<summary>Watch UTXO address, public key or descriptor — no PDF reference</summary>

Component: `Onboarding / AddWatchAccount`.

![Watch UTXO address, public key or descriptor](extras/47-watch-utxo-key-390.png)

[390 px](extras/47-watch-utxo-key-390.png) · [320 px](extras/47-watch-utxo-key-320.png)

</details>

<details>
<summary>Wallet with backup still required — no PDF reference</summary>

Component: `NativePortfolio / WalletBackupBadge`.

![Wallet with backup still required](extras/49-backup-required-home-390.png)

[390 px](extras/49-backup-required-home-390.png) · [320 px](extras/49-backup-required-home-320.png)

</details>

<details>
<summary>ERC-1155 transfer form — no PDF reference</summary>

Component: `NativeSend`.

![ERC-1155 transfer form](extras/13-erc1155-send-390.png)

[390 px](extras/13-erc1155-send-390.png) · [320 px](extras/13-erc1155-send-320.png)

</details>

<details>
<summary>Ledger discovery — no PDF reference</summary>

Component: `NativeLedger`.

![Ledger discovery](extras/33-ledger-connect-390.png)

[390 px](extras/33-ledger-connect-390.png) · [320 px](extras/33-ledger-connect-320.png)

</details>

<details>
<summary>Native coin details — no PDF reference</summary>

Component: `NativePortfolio (native-asset view) / AssetMarketCard`.

![Native coin details](extras/48-asset-details-390.png)

[390 px](extras/48-asset-details-390.png) · [320 px](extras/48-asset-details-320.png)

</details>

<details>
<summary>Healthy market chart — synthetic data — no PDF reference</summary>

Component: `NativePortfolio / AssetMarketCard`.

![Healthy market chart — synthetic data](extras/50-synthetic-market-chart-390.png)

[390 px](extras/50-synthetic-market-chart-390.png) · [320 px](extras/50-synthetic-market-chart-320.png)

</details>

<details>
<summary>Sentry request approval — no PDF reference</summary>

Component: `NativeSentryReview`.

![Sentry request approval](extras/32-sentry-consent-390.png)

[390 px](extras/32-sentry-consent-390.png) · [320 px](extras/32-sentry-consent-320.png)

</details>

<details>
<summary>Message signature review — no PDF reference</summary>

Component: `NativeMessageReview`.

![Message signature review](extras/37-message-signature-390.png)

[390 px](extras/37-message-signature-390.png) · [320 px](extras/37-message-signature-320.png)

</details>

<details>
<summary>Dapp network-change approval — no PDF reference</summary>

Component: `NativeDappControlReview`.

![Dapp network-change approval](extras/38-dapp-network-request-390.png)

[390 px](extras/38-dapp-network-request-390.png) · [320 px](extras/38-dapp-network-request-320.png)

</details>

<details>
<summary>Installed Smart account modules — no PDF reference</summary>

Component: `NativeSmartAccountModules`.

![Installed Smart account modules](extras/51-smart-modules-390.png)

[390 px](extras/51-smart-modules-390.png) · [320 px](extras/51-smart-modules-320.png)

</details>

<details>
<summary>Combined approval policy editor — no PDF reference</summary>

Component: `NativeSmartAccountModules`.

![Combined approval policy editor](extras/53-composite-approvals-390.png)

[390 px](extras/53-composite-approvals-390.png) · [320 px](extras/53-composite-approvals-320.png)

</details>

<details>
<summary>Use Pali wallet — authenticator change — no PDF reference</summary>

Component: `NativeSmartAccountAuthenticator / NativeSmartAccountOperationContent`.

![Use Pali wallet — authenticator change](extras/54-wallet-authenticator-390.png)

[390 px](extras/54-wallet-authenticator-390.png) · [320 px](extras/54-wallet-authenticator-320.png)

</details>

<details>
<summary>Configured Smart account creation consent — no PDF reference</summary>

Component: `NativeSmartPreparationReview`.

![Configured Smart account creation consent](extras/55-smart-creation-consent-390.png)

[390 px](extras/55-smart-creation-consent-390.png) · [320 px](extras/55-smart-creation-consent-320.png)

</details>

<details>
<summary>Smart account infrastructure status — no PDF reference</summary>

Component: `NativeInfrastructure`.

![Smart account infrastructure status](extras/56-infrastructure-status-390.png)

[390 px](extras/56-infrastructure-status-390.png) · [320 px](extras/56-infrastructure-status-320.png)

</details>

<details>
<summary>Smart infrastructure deployment fee review — no PDF reference</summary>

Component: `NativeInfrastructure`.

![Smart infrastructure deployment fee review](extras/57-infrastructure-fee-390.png)

[390 px](extras/57-infrastructure-fee-390.png) · [320 px](extras/57-infrastructure-fee-320.png)

</details>

<details>
<summary>Biometric transaction confirmation — simulated prompt — no PDF reference</summary>

Component: `NativeSend / TransactionAuthentication`.

![Biometric transaction confirmation — simulated prompt](extras/58-biometric-transaction-auth-390.png)

[390 px](extras/58-biometric-transaction-auth-390.png) · [320 px](extras/58-biometric-transaction-auth-320.png)

</details>

<details>
<summary>Settings with backup still required — no PDF reference</summary>

Component: `RealSettings / WalletBackupBadge`.

![Settings with backup still required](extras/59-backup-required-settings-390.png)

[390 px](extras/59-backup-required-settings-390.png) · [320 px](extras/59-backup-required-settings-320.png)

</details>

<details>
<summary>Security with unconfirmed backup — no PDF reference</summary>

Component: `NativeSecurity`.

![Security with unconfirmed backup](extras/60-backup-required-security-390.png)

[390 px](extras/60-backup-required-security-390.png) · [320 px](extras/60-backup-required-security-320.png)

</details>

<details>
<summary>Custom validator risk review — no PDF reference</summary>

Component: `NativeSmartAccountModules / NativeSmartAccountOperationContent`.

![Custom validator risk review](extras/52-custom-validator-consent-390.png)

[390 px](extras/52-custom-validator-consent-390.png) · [320 px](extras/52-custom-validator-consent-320.png)

</details>

These are visual review captures, not physical-device, real-biometrics, camera, hardware-signing or live-funds qualification. The authenticator capture is the implemented change review; it does not imply a separate chooser exists.

## Validation

Mobile TypeScript and scoped lint pass. The composed focused suite passes 713 tests; approval-control checks pass 61 tests. Actual SDK/SQLite regressions cover authentication expiry and storage failures. All displayed captures completed without page errors or horizontal document overflow. Native/device qualification and current-head hosted CI remain separate gates.
