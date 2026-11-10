# Pali mobile screen review — 10 November 2026

All 32 PDF reference states are compared below with screenshots of the **actual implemented React Native components**. Home, Send, Receive and Activity also include frames from the supplied video. Each image opens at full size; each row has a 320-pixel capture for narrow-screen review.

**Source:** `c6a874d8733823fa4ac491fcad23a1d3e7c3c4e4`. Captures use public synthetic wallet/network/connection adapters in a browser at 390×844 and 320×568. They are UI evidence, not native-device, biometric, camera or funded-transaction qualification. Recovery words shown are a publicly known test phrase. No real wallet data is included.

**Known gap:** page 13 currently uses unlocked-session confirmation. Per-send Face ID/fingerprint with password fallback remains to be implemented and reviewed. Page 28 shows the browser fallback for the implemented native camera. Other differences are marked “Adapted”; they are available for product review rather than silently treated as exact matches.

[Open all-screen contact sheet](contact-sheet.png) · [Capture manifest and hashes](manifest.json)

| PDF page | Comparison | Narrow actual capture | Status |
| --- | --- | --- | --- |
| 01 | [Welcome](01-welcome.png) | [320 px](actual/actual-01-320.png) | adapted |
| 02 | [Create PIN](02-create-pin.png) | [320 px](actual/actual-02-320.png) | adapted |
| 03 | [Confirm PIN](03-confirm-pin.png) | [320 px](actual/actual-03-320.png) | adapted |
| 04 | [Fingerprint](04-fingerprint.png) | [320 px](actual/actual-04-320.png) | adapted |
| 05 | [Import wallet](05-import-wallet.png) | [320 px](actual/actual-05-320.png) | implemented |
| 06 | [Confirm restored wallet](06-confirm-restored-wallet.png) | [320 px](actual/actual-06-320.png) | adapted |
| 07 | [Locked](07-locked.png) | [320 px](actual/actual-07-320.png) | adapted |
| 08 | [Recover access](08-recover-access.png) | [320 px](actual/actual-08-320.png) | implemented |
| 09 | [Wallet Home](09-wallet-home.png) | [320 px](actual/actual-09-320.png) | adapted |
| 10 | [Choose Send network](10-choose-send-network.png) | [320 px](actual/actual-10-320.png) | adapted |
| 11 | [Send details](11-send-details.png) | [320 px](actual/actual-11-320.png) | implemented |
| 12 | [Review Send](12-review-send.png) | [320 px](actual/actual-12-320.png) | implemented |
| 13 | [Authorize Send](13-authorize-send.png) | [320 px](actual/actual-13-320.png) | missing |
| 14 | [Send submitted](14-send-submitted.png) | [320 px](actual/actual-14-320.png) | implemented |
| 15 | [Choose Receive network](15-choose-receive-network.png) | [320 px](actual/actual-15-320.png) | adapted |
| 16 | [Receive backup warning](16-receive-backup-warning.png) | [320 px](actual/actual-16-320.png) | adapted |
| 17 | [Receive](17-receive.png) | [320 px](actual/actual-17-320.png) | implemented |
| 18 | [Activity](18-activity.png) | [320 px](actual/actual-18-320.png) | adapted |
| 19 | [Transaction details](19-transaction-details.png) | [320 px](actual/actual-19-320.png) | implemented |
| 20 | [Backup introduction](20-backup-introduction.png) | [320 px](actual/actual-20-320.png) | adapted |
| 21 | [Recovery phrase](21-recovery-phrase.png) | [320 px](actual/actual-21-320.png) | implemented |
| 22 | [Verify backup](22-verify-backup.png) | [320 px](actual/actual-22-320.png) | adapted |
| 23 | [Backup complete](23-backup-complete.png) | [320 px](actual/actual-23-320.png) | implemented |
| 24 | [Settings](24-settings.png) | [320 px](actual/actual-24-320.png) | adapted |
| 25 | [Security](25-security.png) | [320 px](actual/actual-25-320.png) | adapted |
| 26 | [Remove wallet](26-remove-wallet.png) | [320 px](actual/actual-26-320.png) | adapted |
| 27 | [WalletConnect](27-walletconnect.png) | [320 px](actual/actual-27-320.png) | implemented |
| 28 | [Scan WalletConnect QR](28-scan-walletconnect-qr.png) | [320 px](actual/actual-28-320.png) | native-only |
| 29 | [Pairing preview](29-pairing-preview.png) | [320 px](actual/actual-29-320.png) | adapted |
| 30 | [Connection request](30-connection-request.png) | [320 px](actual/actual-30-320.png) | implemented |
| 31 | [Connected app details](31-connected-app-details.png) | [320 px](actual/actual-31-320.png) | adapted |
| 32 | [Transaction request](32-transaction-request.png) | [320 px](actual/actual-32-320.png) | implemented |

<details>
<summary>01. Welcome — adapted</summary>

Wallet setup and watch-only entry. Real component; public test adapters.

![Welcome: reference and implemented screen](01-welcome.png)

[Actual 390 px](actual/actual-01.png) · [Actual 320 px](actual/actual-01-320.png)

Component: `Onboarding.Welcome`

</details>

<details>
<summary>02. Create PIN — adapted</summary>

Wallet password replaces the reference PIN. Create and confirm fields share one form.

![Create PIN: reference and implemented screen](02-create-pin.png)

[Actual 390 px](actual/actual-02.png) · [Actual 320 px](actual/actual-02-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>03. Confirm PIN — adapted</summary>

Confirmation is on the same password form; no separate PIN keypad route.

![Confirm PIN: reference and implemented screen](03-confirm-pin.png)

[Actual 390 px](actual/actual-03.png) · [Actual 320 px](actual/actual-03-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>04. Fingerprint — adapted</summary>

Actual optional setup control. Authentication is simulated in this browser capture; no native prompt is being claimed.

![Fingerprint: reference and implemented screen](04-fingerprint.png)

[Actual 390 px](actual/actual-04.png) · [Actual 320 px](actual/actual-04-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>05. Import wallet — implemented</summary>

Recovery phrase and fallback password form. Only public test wallet data is used.

![Import wallet: reference and implemented screen](05-import-wallet.png)

[Actual 390 px](actual/actual-05.png) · [Actual 320 px](actual/actual-05-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>06. Confirm restored wallet — adapted</summary>

Import continues through the actual mandatory backup flow; no separate restored-wallet summary.

![Confirm restored wallet: reference and implemented screen](06-confirm-restored-wallet.png)

[Actual 390 px](actual/actual-06.png) · [Actual 320 px](actual/actual-06-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>07. Locked — adapted</summary>

Password fallback and optional native biometric unlock replace the PIN keypad.

![Locked: reference and implemented screen](07-locked.png)

[Actual 390 px](actual/actual-07.png) · [Actual 320 px](actual/actual-07-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>08. Recover access — implemented</summary>

Matching recovery phrase authorizes a new local password through the existing recovery flow.

![Recover access: reference and implemented screen](08-recover-access.png)

[Actual 390 px](actual/actual-08.png) · [Actual 320 px](actual/actual-08-320.png)

Component: `NativeRecovery`

</details>

<details>
<summary>09. Wallet Home — adapted</summary>

Full app home: Pali branding, account/network, balance, Send/Receive, Assets and Import token. Selected-network balance replaces combined UTXO/NEVM total.

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

Actual recipient and amount fields; fee and nonce are reviewed using the existing transfer flow.

![Send details: reference and implemented screen](11-send-details.png)

[Actual 390 px](actual/actual-11.png) · [Actual 320 px](actual/actual-11-320.png)

Component: `NativeSend`

</details>

<details>
<summary>12. Review Send — implemented</summary>

Actual review with exact recipient, amount, fee and total before confirmation.

![Review Send: reference and implemented screen](12-review-send.png)

[Actual 390 px](actual/actual-12.png) · [Actual 320 px](actual/actual-12-320.png)

Component: `NativeSend`

</details>

<details>
<summary>13. Authorize Send — missing</summary>

Reference fingerprint authorization is not wired for individual sends. This capture shows the actual unlocked-session confirmation, not a fake biometric screen.

![Authorize Send: reference and implemented screen](13-authorize-send.png)

[Actual 390 px](actual/actual-13.png) · [Actual 320 px](actual/actual-13-320.png)

Component: `NativeSend`

</details>

<details>
<summary>14. Send submitted — implemented</summary>

Actual pending outcome after explicit confirmation. Pending is not presented as confirmed.

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
<summary>16. Receive backup warning — adapted</summary>

Backup is required before the portfolio can be used, rather than adding a warning only when Receive opens.

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

Approved header and direction filters retained. Compact dated rows replace large cards; full amounts and hashes remain in details.

![Activity: reference and implemented screen](18-activity.png)

[Actual 390 px](actual/actual-18.png) · [Actual 320 px](actual/actual-18-320.png)

Component: `NativeActivityScreen + ActivityListRow`

</details>

<details>
<summary>19. Transaction details — implemented</summary>

Full exact values and transaction identifiers remain available in the detail screen.

![Transaction details: reference and implemented screen](19-transaction-details.png)

[Actual 390 px](actual/actual-19.png) · [Actual 320 px](actual/actual-19-320.png)

Component: `NativeActivityScreen`

</details>

<details>
<summary>20. Backup introduction — adapted</summary>

Actual password-protected backup introduction. No postpone action when backup is required.

![Backup introduction: reference and implemented screen](20-backup-introduction.png)

[Actual 390 px](actual/actual-20.png) · [Actual 320 px](actual/actual-20-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>21. Recovery phrase — implemented</summary>

Actual numbered word grid using the publicly known test phrase only.

![Recovery phrase: reference and implemented screen](21-recovery-phrase.png)

[Actual 390 px](actual/actual-21.png) · [Actual 320 px](actual/actual-21-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>22. Verify backup — adapted</summary>

Three selected-word checks replace rearranging all words.

![Verify backup: reference and implemented screen](22-verify-backup.png)

[Actual 390 px](actual/actual-22.png) · [Actual 320 px](actual/actual-22-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>23. Backup complete — implemented</summary>

New completion state after actual backup confirmation; secret presentation cleared before this screen.

![Backup complete: reference and implemented screen](23-backup-complete.png)

[Actual 390 px](actual/actual-23.png) · [Actual 320 px](actual/actual-23-320.png)

Component: `NativeWalletScreen`

</details>

<details>
<summary>24. Settings — adapted</summary>

Production settings including security, auto-lock, language and currency; Connected apps is in Tools.

![Settings: reference and implemented screen](24-settings.png)

[Actual 390 px](actual/actual-24.png) · [Actual 320 px](actual/actual-24-320.png)

Component: `RealSettings`

</details>

<details>
<summary>25. Security — adapted</summary>

Password-based security, phrase/key backup and optional biometric unlock. Auto-lock is a separate settings route.

![Security: reference and implemented screen](25-security.png)

[Actual 390 px](actual/actual-25.png) · [Actual 320 px](actual/actual-25-320.png)

Component: `NativeSecurity`

</details>

<details>
<summary>26. Remove wallet — adapted</summary>

Fresh password followed by an explicit destructive confirmation; no real wallet is removed in this capture.

![Remove wallet: reference and implemented screen](26-remove-wallet.png)

[Actual 390 px](actual/actual-26.png) · [Actual 320 px](actual/actual-26-320.png)

Component: `NativeWalletRemovalScreen`

</details>

<details>
<summary>27. WalletConnect — implemented</summary>

Actual scan/paste entry and session management.

![WalletConnect: reference and implemented screen](27-walletconnect.png)

[Actual 390 px](actual/actual-27.png) · [Actual 320 px](actual/actual-27-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>28. Scan WalletConnect QR — native-only</summary>

Native camera implementation exists; this browser capture honestly shows its fallback. Device-camera qualification remains separate.

![Scan WalletConnect QR: reference and implemented screen](28-scan-walletconnect-qr.png)

[Actual 390 px](actual/actual-28.png) · [Actual 320 px](actual/actual-28-320.png)

Component: `ConnectionQrScanner.web`

</details>

<details>
<summary>29. Pairing preview — adapted</summary>

Actual wait-for-proposal state. A pairing link does not establish a trustworthy app identity for a fabricated preview.

![Pairing preview: reference and implemented screen](29-pairing-preview.png)

[Actual 390 px](actual/actual-29.png) · [Actual 320 px](actual/actual-29-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>30. Connection request — implemented</summary>

Actual verified-origin proposal review with account/network choice and Connect/Reject. Public synthetic proposal.

![Connection request: reference and implemented screen](30-connection-request.png)

[Actual 390 px](actual/actual-30.png) · [Actual 320 px](actual/actual-30-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>31. Connected app details — adapted</summary>

Actual session card and Disconnect action are inline rather than a separate details route.

![Connected app details: reference and implemented screen](31-connected-app-details.png)

[Actual 390 px](actual/actual-31.png) · [Actual 320 px](actual/actual-31-320.png)

Component: `NativeConnections`

</details>

<details>
<summary>32. Transaction request — implemented</summary>

Actual dapp-origin, account/network, recipient, amount and fee review. Synthetic public request; no live signature.

![Transaction request: reference and implemented screen](32-transaction-request.png)

[Actual 390 px](actual/actual-32.png) · [Actual 320 px](actual/actual-32-320.png)

Component: `NativeTransactionReviewScreen`

</details>

