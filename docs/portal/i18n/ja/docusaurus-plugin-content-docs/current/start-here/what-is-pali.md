---
title: Paliとは
---

Pali Walletは公式のSyscoinウォレット拡張機能であり、EVM互換チェーン向けの汎用web3ウォレットです。重なり合う3つの利用者層を想定して設計されています。

- **一般ユーザー**: EVM、Syscoin、Rollux、UTXOアセットに対応する安全なブラウザウォレットを求めるユーザー。
- **Dapp開発者**: 同じ拡張機能からMetaMask互換のEVMアクセスとUTXOアクセスを利用したい開発者。
- **機関**: passkeyスマートアカウント、アカウント復元、スポンサーpolicy、dapp主導のオンボーディングを求める機関。

## Paliの違い

ほとんどのブラウザウォレットはEVMプロバイダーだけを公開します。Paliは補完的な2つのサーフェスを公開します。

- EVM dapps向けの`window.ethereum`。一般的なMetaMaskフローとの互換性を意図しています。
- Syscoin UTXOおよびBitcoinスタイルのフロー向けの`window.pali`。

これにより、dappはユーザーに別々のウォレットをインストールさせることなく、アカウントベースのチェーンとUTXOベースのチェーンをまたぐ体験を構築できます。

## 互換性の概要

| 機能 | サポートされるサーフェス |
| --- | --- |
| EIP-1193プロバイダーリクエスト | `window.ethereum` |
| EIP-6963ウォレットディスカバリー | `window.ethereum`プロバイダーアナウンス |
| アカウント権限 | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| EVMトランザクションと署名 | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, 関連する署名メソッド |
| EIP-5792バッチリクエスト | `wallet_sendCalls`, `wallet_getCapabilities` |
| UTXOアカウントとxpub状態 | `window.pali`と`sys_*`メソッド |
| PSBT署名とブロードキャスト | `sys_sign`, `sys_signAndSend` |
| Passkeyスマートアカウント作成 | `wallet_prepareSmartAccount` |

## 現在のpasskeyスコープ

Paliスマートアカウントは、Paliが使用するアドレスにPali factoryとmodulesが存在するEVMネットワークで利用できます。このPaliビルドでは`zkTanenbaum`テストネット（`57057`）が設定されています。zkSYS本番サポートは、本番アドレスが設定されると同じアーキテクチャを使用します。

インフラはPaliが運用するチェーンに限定されません。canonical CREATE2をサポートする互換EVMネットワークでは、Paliが必要なスマートアカウント設定をウォレット内でデプロイできます。Pali Settingsを開き、Advancedに移動し、**Smart account setup** のDeployボタンを使ってください。Passkey validatorにはP-256 WebAuthn検証が必要で、多くの新しいEVM環境ではP-256/passkey precompileで提供されています。
