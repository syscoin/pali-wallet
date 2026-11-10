# Additional implemented screens

65 feature states; 130 fresh captures at 390×844 and 320×568.

UI source: a5a188be5e5114fc924b6596379142ea65c72a04. All frames use this source checkpoint; exact routes, timestamps and loaded asset URLs remain in manifest.json.

All captures render actual RNWeb components with synthetic public fixture adapters. No physical hardware, device biometric/camera/keyboard, live funds, or live network signing is represented. All external network access was blocked. The healthy market chart uses locally fulfilled, explicitly synthetic test responses. Development-only copy may be visible because these are development fixture exports.

## 01-watch-wallet — Watch-only account

Component: App / RealPortfolio.

Route: http://127.0.0.1:4292/?evm-activity=1&evm-activity-mode=value

Actions: View my accounts.

![Watch-only account at 390px](01-watch-wallet-390.png)

![Watch-only account at 320px](01-watch-wallet-320.png)

## 02-account-manager — Native account manager

Component: NativeAccounts.

Route: http://127.0.0.1:4291/?accounts=1

Actions: Initial state.

![Native account manager at 390px](02-account-manager-390.png)

![Native account manager at 320px](02-account-manager-320.png)

## 03-create-account — Create another software account

Component: NativeAccounts.

Route: http://127.0.0.1:4291/?accounts=1

Actions: Add account → Create account.

![Create another software account at 390px](03-create-account-390.png)

![Create another software account at 320px](03-create-account-320.png)

## 04-network-add — Add a custom network

Component: NativeNetworks.

Route: http://127.0.0.1:4291/?networks=1

Actions: Add network.

![Add a custom network at 390px](04-network-add-390.png)

![Add a custom network at 320px](04-network-add-320.png)

## 05-token-assets — Token assets

Component: NativePortfolio.

Route: http://127.0.0.1:4291/?token-portfolio&holdings

Actions: Initial state.

![Token assets at 390px](05-token-assets-390.png)

![Token assets at 320px](05-token-assets-320.png)

## 06-import-token — Import token / find holdings

Component: NativeTokens.

Route: http://127.0.0.1:4291/?token-portfolio&holdings

Actions: Import token → Find holdings.

![Import token / find holdings at 390px](06-import-token-390.png)

![Import token / find holdings at 320px](06-import-token-320.png)

## 07-token-review — Verified token preview

Component: NativeTokens.

Route: http://127.0.0.1:4291/?token-portfolio&holdings

Actions: Import token → Enter public contract → Review token.

![Verified token preview at 390px](07-token-review-390.png)

![Verified token preview at 320px](07-token-review-320.png)

## 08-collectible-discovery — Collectible discovery

Component: NativeTokens.

Route: http://127.0.0.1:4291/?token-portfolio&holdings

Actions: Collectibles → Find collectibles.

![Collectible discovery at 390px](08-collectible-discovery-390.png)

![Collectible discovery at 320px](08-collectible-discovery-320.png)

## 09-collectible-ownership — Collectible ownership form

Component: NativeTokens / CollectibleOwnership.

Route: http://127.0.0.1:4291/?token-portfolio&holdings&collectible-check

Actions: Collectibles → Check by contract.

![Collectible ownership form at 390px](09-collectible-ownership-390.png)

![Collectible ownership form at 320px](09-collectible-ownership-320.png)

## 10-evm-nonce — EVM advanced nonce

Component: NativeSend.

Route: http://127.0.0.1:4291/?

Actions: Advanced options → Scroll to Transaction nonce.

![EVM advanced nonce at 390px](10-evm-nonce-390.png)

![EVM advanced nonce at 320px](10-evm-nonce-320.png)

## 11-utxo-advanced — UTXO advanced transaction options

Component: NativeUtxoSend.

Route: http://127.0.0.1:4291/?utxo-send=1

Actions: Advanced options → Scroll to Replace-by-fee.

![UTXO advanced transaction options at 390px](11-utxo-advanced-390.png)

![UTXO advanced transaction options at 320px](11-utxo-advanced-320.png)

## 12-erc20-send — ERC-20 transfer form

Component: NativeSend.

Route: http://127.0.0.1:4291/?erc20-send=1

Actions: Initial state.

![ERC-20 transfer form at 390px](12-erc20-send-390.png)

![ERC-20 transfer form at 320px](12-erc20-send-320.png)

## 13-erc1155-send — ERC-1155 transfer form

Component: NativeSend.

Route: http://127.0.0.1:4291/?collectible=1155

Actions: Initial state.

![ERC-1155 transfer form at 390px](13-erc1155-send-390.png)

![ERC-1155 transfer form at 320px](13-erc1155-send-320.png)

## 14-guardian-policy — Guardian policy and status

Component: NativeGuardianPolicy.

Route: http://127.0.0.1:4291/?guardian-policy=1

Actions: Check status.

![Guardian policy and status at 390px](14-guardian-policy-390.png)

![Guardian policy and status at 320px](14-guardian-policy-320.png)

## 15-guardian-policy-edit — Guardian policy editor

Component: NativeGuardianPolicy.

Route: http://127.0.0.1:4291/?guardian-policy=1&new-policy

Actions: Check status → Set guardian.

![Guardian policy editor at 390px](15-guardian-policy-edit-390.png)

![Guardian policy editor at 320px](15-guardian-policy-edit-320.png)

## 16-smart-guardian-recovery — Smart guardian / separate payer recovery

Component: NativeGuardianRecovery.

Route: http://127.0.0.1:4291/?guardian-recovery=1&smart-guardian=1

Actions: Initial state.

![Smart guardian / separate payer recovery at 390px](16-smart-guardian-recovery-390.png)

![Smart guardian / separate payer recovery at 320px](16-smart-guardian-recovery-320.png)

## 17-guardian-recovery-review — Guardian recovery proof review

Component: NativeGuardianRecovery.

Route: http://127.0.0.1:4291/?guardian-recovery=1&smart-guardian=1

Actions: Choose replacement owner → Replacement key → Review recovery.

![Guardian recovery proof review at 390px](17-guardian-recovery-review-390.png)

![Guardian recovery proof review at 320px](17-guardian-recovery-review-320.png)

## 18-slh-keys — SLH-DSA prepared keys

Component: NativeSlhDsaManagement.

Route: http://127.0.0.1:4292/?slh-fixture=ready

Actions: Initial state.

![SLH-DSA prepared keys at 390px](18-slh-keys-390.png)

![SLH-DSA prepared keys at 320px](18-slh-keys-320.png)

## 19-slh-installed — SLH-DSA installed keys

Component: NativeSlhDsaManagement.

Route: http://127.0.0.1:4292/?slh-fixture=installed

Actions: Initial state.

![SLH-DSA installed keys at 390px](19-slh-installed-390.png)

![SLH-DSA installed keys at 320px](19-slh-installed-320.png)

## 20-smart-transfer — Smart account transfer

Component: NativeSmartAccountSend.

Route: http://127.0.0.1:4291/?smart-currency=1

Actions: Initial state.

![Smart account transfer at 390px](20-smart-transfer-390.png)

![Smart account transfer at 320px](20-smart-transfer-320.png)

## 21-smart-deployment — Smart account deployment authorization

Component: NativeSmartAccountOperation.

Route: http://127.0.0.1:4291/?smart-deployment=1

Actions: Initial state.

![Smart account deployment authorization at 390px](21-smart-deployment-390.png)

![Smart account deployment authorization at 320px](21-smart-deployment-320.png)

## 22-smart-batch — Smart account batched calls

Component: NativeSmartTransactionReview.

Route: http://127.0.0.1:4291/?smart-batch=1

Actions: Initial state.

![Smart account batched calls at 390px](22-smart-batch-390.png)

![Smart account batched calls at 320px](22-smart-batch-320.png)

## 23-eoa-batch — Software account batched calls

Component: NativeTransactionReview.

Route: http://127.0.0.1:4291/?eoa-batch=1

Actions: Initial state.

![Software account batched calls at 390px](23-eoa-batch-390.png)

![Software account batched calls at 320px](23-eoa-batch-320.png)

## 24-private-deposit — Private deposit form

Component: NativePrivateDeposit.

Route: http://127.0.0.1:4291/?private-deposit=1

Actions: Initial state.

![Private deposit form at 390px](24-private-deposit-390.png)

![Private deposit form at 320px](24-private-deposit-320.png)

## 25-private-deposit-review — Private deposit review

Component: NativePrivateDeposit.

Route: http://127.0.0.1:4291/?private-deposit=1

Actions: Review deposit.

![Private deposit review at 390px](25-private-deposit-review-390.png)

![Private deposit review at 320px](25-private-deposit-review-320.png)

## 26-private-notes — Private note inventory

Component: NativeNoteInventory.

Route: http://127.0.0.1:4291/?private-withdrawal=1

Actions: Initial state.

![Private note inventory at 390px](26-private-notes-390.png)

![Private note inventory at 320px](26-private-notes-320.png)

## 27-private-withdrawal — Private withdrawal form

Component: NativePrivateWithdrawal.

Route: http://127.0.0.1:4291/?private-withdrawal=1

Actions: Select 1 ETH pool → Check pool status → Withdraw.

![Private withdrawal form at 390px](27-private-withdrawal-390.png)

![Private withdrawal form at 320px](27-private-withdrawal-320.png)

## 28-import-note — Import private note

Component: NativeNoteImport.

Route: http://127.0.0.1:4291/?note-import=1

Actions: Initial state.

![Import private note at 390px](28-import-note-390.png)

![Import private note at 320px](28-import-note-320.png)

## 29-sentry-keys — Sentry key management

Component: NativeSentryKeys.

Route: http://127.0.0.1:4291/?sentry=1

Actions: Initial state.

![Sentry key management at 390px](29-sentry-keys-390.png)

![Sentry key management at 320px](29-sentry-keys-320.png)

## 30-sentry-service — Sentry service settings

Component: NativeSentrySettings.

Route: http://127.0.0.1:4291/?sentry=1

Actions: Service settings.

![Sentry service settings at 390px](30-sentry-service-390.png)

![Sentry service settings at 320px](30-sentry-service-320.png)

## 31-sentry-nodes — Sentry nodes

Component: NativeSentryNodes.

Route: http://127.0.0.1:4291/?sentry-nodes=1

Actions: Initial state.

![Sentry nodes at 390px](31-sentry-nodes-390.png)

![Sentry nodes at 320px](31-sentry-nodes-320.png)

## 32-sentry-consent — Sentry request approval

Component: NativeSentryReview.

Route: http://127.0.0.1:4291/?sentry-consent=1

Actions: Initial state.

![Sentry request approval at 390px](32-sentry-consent-390.png)

![Sentry request approval at 320px](32-sentry-consent-320.png)

## 33-ledger-connect — Ledger discovery

Component: NativeLedger.

Route: http://127.0.0.1:4291/?ledger=1

Actions: Find Ledger.

![Ledger discovery at 390px](33-ledger-connect-390.png)

![Ledger discovery at 320px](33-ledger-connect-320.png)

## 34-ledger-account — Ledger account review

Component: NativeLedger.

Route: http://127.0.0.1:4291/?ledger=1

Actions: Find Ledger → My Ledger · Nano X.

![Ledger account review at 390px](34-ledger-account-390.png)

![Ledger account review at 320px](34-ledger-account-320.png)

## 35-trezor-import — Trezor account import

Component: NativeTrezor.

Route: http://127.0.0.1:4291/?trezor=1

Actions: Initial state.

![Trezor account import at 390px](35-trezor-import-390.png)

![Trezor account import at 320px](35-trezor-import-320.png)

## 36-trezor-smart-resume — Trezor Smart owner continuation

Component: NativeTrezorResumeNotice.

Route: http://127.0.0.1:4291/?trezor=1&resume=smart

Actions: Initial state.

Actual resume notice only; Continue is not invoked because this fixture transitions to placeholder review copy.

![Trezor Smart owner continuation at 390px](36-trezor-smart-resume-390.png)

![Trezor Smart owner continuation at 320px](36-trezor-smart-resume-320.png)

## 37-message-signature — Message signature review

Component: NativeMessageReview.

Route: http://127.0.0.1:4291/?message-review=1

Actions: Initial state.

![Message signature review at 390px](37-message-signature-390.png)

![Message signature review at 320px](37-message-signature-320.png)

## 38-dapp-network-request — Dapp network-change approval

Component: NativeDappControlReview.

Route: http://127.0.0.1:4291/?control-consent=1

Actions: Initial state.

![Dapp network-change approval at 390px](38-dapp-network-request-390.png)

![Dapp network-change approval at 320px](38-dapp-network-request-320.png)

## 39-auto-lock — Auto-lock preferences

Component: AutoLockSettings.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Security & backups → Auto-lock.

![Auto-lock preferences at 390px](39-auto-lock-390.png)

![Auto-lock preferences at 320px](39-auto-lock-320.png)

## 40-biometric-settings — Biometric enrollment settings

Component: NativeWallet.native (device-unlock stage).

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Security & backups → Biometric unlock.

![Biometric enrollment settings at 390px](40-biometric-settings-390.png)

![Biometric enrollment settings at 320px](40-biometric-settings-320.png)

## 41-import-private-key — Import software private key

Component: NativeImport.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Accounts → Manage wallet accounts → Add account → Import private key.

![Import software private key at 390px](41-import-private-key-390.png)

![Import software private key at 320px](41-import-private-key-320.png)

## 42-display-currency — Display currency preferences

Component: DisplayCurrency.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Display currency.

![Display currency preferences at 390px](42-display-currency-390.png)

![Display currency preferences at 320px](42-display-currency-320.png)

## 43-languages — Language preferences

Component: NativePreferences.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Languages.

![Language preferences at 390px](43-languages-390.png)

![Language preferences at 320px](43-languages-320.png)

## 44-help-about — Help and about

Component: HelpAbout.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Help & about.

![Help and about at 390px](44-help-about-390.png)

![Help and about at 320px](44-help-about-320.png)

## 45-private-key-auth — Private-key reveal authorization

Component: NativeSecurity.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Security & backups → Reveal account private key.

![Private-key reveal authorization at 390px](45-private-key-auth-390.png)

![Private-key reveal authorization at 320px](45-private-key-auth-320.png)

## 46-watch-address-form — Add public watch account

Component: Onboarding / AddWatchAccount.

Route: http://127.0.0.1:4292/?evm-activity=1&evm-activity-mode=value

Actions: Accounts → Watch an account.

![Add public watch account at 390px](46-watch-address-form-390.png)

![Add public watch account at 320px](46-watch-address-form-320.png)

## 47-watch-utxo-key — Watch UTXO address, public key or descriptor

Component: Onboarding / AddWatchAccount.

Route: http://127.0.0.1:4292/?evm-activity=1&evm-activity-mode=value

Actions: Accounts → Watch an account → Bitcoin network → Scroll to public identifier.

![Watch UTXO address, public key or descriptor at 390px](47-watch-utxo-key-390.png)

![Watch UTXO address, public key or descriptor at 320px](47-watch-utxo-key-320.png)

## 48-asset-details — Native coin details

Component: NativePortfolio (native-asset view) / AssetMarketCard.

Route: http://127.0.0.1:4291/?network-portfolio=1

Actions: ETH Ethereum.

The existing fixture has no successful market-history provider; the actual unavailable state is shown. No chart data was invented.

![Native coin details at 390px](48-asset-details-390.png)

![Native coin details at 320px](48-asset-details-320.png)

## 49-backup-required-home — Wallet with backup still required

Component: NativePortfolio / WalletBackupBadge.

Route: http://127.0.0.1:4292/?visual-review=1&backup-required=1

Actions: Unlock synthetic wallet with unconfirmed backup.

![Wallet with backup still required at 390px](49-backup-required-home-390.png)

![Wallet with backup still required at 320px](49-backup-required-home-320.png)

## 50-synthetic-market-chart — Healthy market chart — synthetic data

Component: NativePortfolio / AssetMarketCard.

Route: http://127.0.0.1:4291/?network-portfolio=1

Actions: Intercept only quote/market responses with synthetic test data → ETH Ethereum → Wait for real chart → Scroll market card into view.

Explicitly synthetic CoinGecko-shaped data from the tests/assetMarket.test.ts contract: 2,200 USD, -1.2%, 2,100/2,300 low/high, 250 billion USD cap, four seven-day samples. No remote market data was fetched.

![Healthy market chart — synthetic data at 390px](50-synthetic-market-chart-390.png)

![Healthy market chart — synthetic data at 320px](50-synthetic-market-chart-320.png)

## 51-smart-modules — Installed Smart account modules

Component: NativeSmartAccountModules.

Route: http://127.0.0.1:4291/?smart-modules=1

Actions: Initial state.

![Installed Smart account modules at 390px](51-smart-modules-390.png)

![Installed Smart account modules at 320px](51-smart-modules-320.png)

## 52-custom-validator-consent — Custom validator risk review

Component: NativeSmartAccountModules / NativeSmartAccountOperationContent.

Route: http://127.0.0.1:4291/?smart-modules=1

Actions: Custom validator → Enter synthetic module address and name → Check module → Install (opens review only) → Scroll to real risk acknowledgement; leave it off.

![Custom validator risk review at 390px](52-custom-validator-consent-390.png)

![Custom validator risk review at 320px](52-custom-validator-consent-320.png)

## 53-composite-approvals — Combined approval policy editor

Component: NativeSmartAccountModules.

Route: http://127.0.0.1:4291/?smart-modules=1

Actions: Combined approvals.

![Combined approval policy editor at 390px](53-composite-approvals-390.png)

![Combined approval policy editor at 320px](53-composite-approvals-320.png)

## 54-wallet-authenticator — Use Pali wallet — authenticator change

Component: NativeSmartAccountAuthenticator / NativeSmartAccountOperationContent.

Route: http://127.0.0.1:4291/?smart-authenticator=1

Actions: Initial state.

![Use Pali wallet — authenticator change at 390px](54-wallet-authenticator-390.png)

![Use Pali wallet — authenticator change at 320px](54-wallet-authenticator-320.png)

## 55-smart-creation-consent — Configured Smart account creation consent

Component: NativeSmartPreparationReview.

Route: http://127.0.0.1:4291/?smart-preparation=1&preparation-mode=configured

Actions: Show requested external owners; acknowledgement remains off.

![Configured Smart account creation consent at 390px](55-smart-creation-consent-390.png)

![Configured Smart account creation consent at 320px](55-smart-creation-consent-320.png)

## 56-infrastructure-status — Smart account infrastructure status

Component: NativeInfrastructure.

Route: http://127.0.0.1:4291/?smart-infrastructure=1

Actions: Initial state.

![Smart account infrastructure status at 390px](56-infrastructure-status-390.png)

![Smart account infrastructure status at 320px](56-infrastructure-status-320.png)

## 57-infrastructure-fee — Smart infrastructure deployment fee review

Component: NativeInfrastructure.

Route: http://127.0.0.1:4291/?smart-infrastructure=1

Actions: Review setup fee.

![Smart infrastructure deployment fee review at 390px](57-infrastructure-fee-390.png)

![Smart infrastructure deployment fee review at 320px](57-infrastructure-fee-320.png)

## 58-biometric-transaction-auth — Biometric-enabled transaction review

Component: NativeSend.

Route: http://127.0.0.1:4291/?biometric-auth=1

Actions: Enter public recipient and 0.001 ETH → Review transfer → Show biometric-enabled Confirm and send plus Use PIN instead.

Actual review configured for biometrics, with an explicit Use PIN instead alternative. No confirmation button is pressed: no OS prompt, biometric proof, signature or submission is performed.

![Biometric-enabled transaction review at 390px](58-biometric-transaction-auth-390.png)

![Biometric-enabled transaction review at 320px](58-biometric-transaction-auth-320.png)

## 59-backup-required-settings — Settings with backup still required

Component: RealSettings / WalletBackupBadge.

Route: http://127.0.0.1:4292/?visual-review=1&backup-required=1

Actions: Unlock synthetic wallet with unconfirmed backup → Settings.

![Settings with backup still required at 390px](59-backup-required-settings-390.png)

![Settings with backup still required at 320px](59-backup-required-settings-320.png)

## 60-backup-required-security — Security with unconfirmed backup

Component: NativeSecurity.

Route: http://127.0.0.1:4292/?visual-review=1&backup-required=1

Actions: Unlock synthetic wallet with unconfirmed backup → Settings → Security & backups.

![Security with unconfirmed backup at 390px](60-backup-required-security-390.png)

![Security with unconfirmed backup at 320px](60-backup-required-security-320.png)

## 61-change-pin-current — Change PIN — current PIN

Component: NativeWallet / PinEntryScreen.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Security & backups → Change PIN.

![Change PIN — current PIN at 390px](61-change-pin-current-390.png)

![Change PIN — current PIN at 320px](61-change-pin-current-320.png)

## 62-change-pin-create — Change PIN — choose new PIN

Component: NativeWallet / PinSetup.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Security & backups → Change PIN → Enter current synthetic PIN.

![Change PIN — choose new PIN at 390px](62-change-pin-create-390.png)

![Change PIN — choose new PIN at 320px](62-change-pin-create-320.png)

## 63-change-pin-confirm — Change PIN — confirm new PIN

Component: NativeWallet / PinSetup.

Route: http://127.0.0.1:4292/?visual-review=1

Actions: Unlock synthetic wallet → Settings → Security & backups → Change PIN → Enter current synthetic PIN → Enter new synthetic PIN; do not commit.

![Change PIN — confirm new PIN at 390px](63-change-pin-confirm-390.png)

![Change PIN — confirm new PIN at 320px](63-change-pin-confirm-320.png)

## 64-pin-transaction-auth — PIN transaction confirmation

Component: NativeSend / TransactionAuthentication / PinPad.

Route: http://127.0.0.1:4291/?

Actions: Enter public recipient and 0.001 ETH → Review transfer → Confirm opens real PIN authentication.

Actual PIN authentication UI only. No PIN is entered into this review, no signature or transaction submission is performed.

![PIN transaction confirmation at 390px](64-pin-transaction-auth-390.png)

![PIN transaction confirmation at 320px](64-pin-transaction-auth-320.png)

## 65-smart-send-form — Smart account send form

Component: NativeSmartAccountSend / SendNetworkCard.

Route: http://127.0.0.1:4291/?smart-currency=1

Actions: Initial state.

![Smart account send form at 390px](65-smart-send-form-390.png)

![Smart account send form at 320px](65-smart-send-form-320.png)

## Not represented

- **Hardware infrastructure payer continuation:** apps/mobile/src/screens/NativeInfrastructure.tsx is captured with a synthetic software payer. Ledger connection and Trezor Suite continuation for infrastructure are not represented by these new fixture routes.
- **Physical Ledger, Trezor, biometric, camera and OS keyboard states:** This gallery uses public synthetic adapters in RNWeb. Real device prompts, transport, camera and keyboard are not represented.

## Capture checks

- Page errors: 0
- Horizontal document overflow: 0
- Unrendered attempts: 0
