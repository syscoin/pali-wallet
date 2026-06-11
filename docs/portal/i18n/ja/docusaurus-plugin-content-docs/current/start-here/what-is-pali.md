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

## Pali は何が違うのか？

Pali は「ウォレットこそがユーザーのセキュリティ境界であり、サーバーではない」という考え方で作られています。Pali は他のブラウザウォレットと同じように RPC ノード、エクスプローラー、インデクサーから読み取れますが、カストディ、承認、復元、アカウントポリシーはユーザーの鍵とオンチェーンモジュールに残ります。

- **カストディサーバーも復元サーバーもありません。** Pali はサーバー側の鍵、クラウド上の暗号化データ、ポリシーエンジン、復元用バックドアを保持しません。重要な操作は拡張機能内で承認され、ユーザーのウォレット、passkey、ハードウェアデバイス、またはスマートアカウントの validator によって署名され、チェーンによって強制されます。
- **フォールバック付きの高速読み取り。** Pali が多数の EVM コントラクト読み取りを必要とする場合、まず Multicall3 `aggregate3` を試します。これは 1 回のオンチェーン `eth_call`、同一ブロックのビュー、呼び出しごとの失敗分離を提供します。Multicall3 が未デプロイ、または RPC が拒否する場合は JSON-RPC バッチにフォールバックし、それも使えない場合は個別呼び出しに戻ります。
- **2 つのチェーンファミリーを 1 つのウォレットで。** Pali は EVM dapp 向けに MetaMask 互換の `window.ethereum`、Syscoin UTXO / Bitcoin 風フロー向けに `window.pali` を公開します。dapp はアカウントベース資産、UTXO、PSBT、xpub を 1 つの拡張機能から扱えます。
- **通常アカウントとスマートアカウント。** ユーザーは EOA 風の通常アカウント、ハードウェアウォレットアカウント、Pali スマートアカウントを並べて使えます。通常アカウントはシンプルで移植性があります。スマートアカウントは passkey、ウォレット所有 ECDSA validator、composite threshold policy、guardian recovery、カスタムモジュールなどのプログラム可能な policy を追加します。
- **標準を優先した dapp 統合。** Pali は dapp がすでに使っているウォレット API に従います。EIP-1193、EIP-6963、EIP-2255 permissions、EIP-5792 `wallet_sendCalls`、EIP-712 typed data、MetaMask 互換の request behavior です。Pali スマートアカウントは ERC-7579 風の validator/executor module と ERC-4337 風の execution data を使います。
- **プログラム可能な認可。** Pali スマートアカウントでは、アドレスは安定したまま署名 policy を進化させられます。validator は誰が action を承認できるかを決め、executor は guardian recovery などの機能を追加します。チームは資金を移動せずに、passkey から threshold policy へ移行したり、復元を追加したり、新しい validator タイプを採用できます。
- **将来のより強い署名に備えた設計。** 認可がモジュール式であるため、将来の validator は ECDSA や P-256 passkey を超える方式、対象チェーンで実用的になったポスト量子署名方式もサポートできます。
- **利便性より安全性。** Pali はブロッキング承認を直列化し、接続済みサイトとネットワークコンテキストを確認し、送信と承認に対する高リスクの blacklist ヒットをブロックし、guardian recovery をトランザクション署名から分離します。guardian は遅延後のアクセス復元を助けられますが、密かに資金を使うことはできません。

Pali の方向性は、**実際のユーザーと実際の dapp のためのセルフカストディ型プログラム可能アカウント**です。日常利用に十分速く、開発者に十分標準的で、機関に十分柔軟で、セキュリティ上重要な制御がユーザーとチェーンに残るほど保守的です。

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
