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

## Pali v4の新機能

Pali v4は、速度、標準、柔軟な署名権限という3つの考え方を軸に、ウォレットをゼロから近代化したものです。

- **あらゆる場面で高速。** PaliはEVMとUTXOの両ネットワークでRPCトラフィックをバッチ化するため、残高、履歴、手数料データがはるかに少ないラウンドトリップで読み込まれます。その結果、待たされる感覚のない、即座に反応するウォレットになります。
- **標準ベースのスマートアカウント。** Paliスマートアカウントは、ERC-4337風のexecution encodingを備えたERC-7579モジュールモデルに従います。アカウントに独自仕様によるロックインは一切なく、validator、executor、アカウントの挙動はすべて公開仕様に従います。
- **認可はアカウントから分離。** 誰が署名できるかはモジュールの決定事項であり、アドレスに焼き付けられた属性ではありません。現在はウォレット所有のECDSAキーとP-256 WebAuthn passkeyがこれにあたります。将来的には、ポスト量子署名方式を含む新しいvalidatorタイプを同じアドレスの同じアカウントにインストールでき、トランザクションごとの認可にECDSAを一切介在させないことも可能になります。
- **組み合わせ可能な署名policy。** composite validatorは子validatorをthresholdの下で組み合わせます。利便性のための1-of-N、共同管理のためのt-of-N、最大限の保証のためのN-of-Nです。compositeはネストできるため、policyを階層化できます。
- **Guardianはアクセス喪失から守る。** Guardian recoveryは（ERC-7579に基づく）独立したexecutorロールのモジュールであり、validatorとは意図的に区別されています。guardianはトランザクションに署名できず、できるのはtimelock付きのvalidator置き換えをスケジュールすることだけです。アカウントが健全な間は、いつでもguardianを追加・削除できます。

## Paliの今後の方向性

Paliの方向性は、**暗号資産フロントエンドのための動的で柔軟な署名権限**です。dapp、取引所、機関向けダッシュボード、組み込みサービスなど、あらゆるフロントエンドが、その用途にちょうど必要な署名policyをウォレットに要求できるべきです。手間のないオンボーディングにはpasskey、共有トレジャリーにはt-of-N composite、復元にはハードウェアに裏付けられたguardian、さらにはまだ存在しない将来のvalidatorタイプも対象です。アカウントアドレスは安定したまま、その背後にある権限だけが進化します。

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
