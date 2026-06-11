---
title: Pali Walletへようこそ
slug: /
---

Pali Walletは、1つのセキュリティレイヤーからアカウントベースとUTXOベースの両方のブロックチェーンアクセスを必要とするユーザーとアプリケーション向けのブラウザ拡張ウォレットです。

EVM dapps向けに、PaliはEIP-1193リクエスト、EIP-6963ディスカバリー、アカウント権限、チェーン切り替え、署名、トランザクション、バッチ呼び出しに対応したMetaMask互換の`window.ethereum`プロバイダーを公開します。Syscoin UTXOおよびBitcoinスタイルのアプリケーション向けに、Paliはアカウント、xpub、変更アドレス、PSBT署名、トランザクション、アセットの各メソッドを備えた`window.pali`を公開します。

Paliは、機関や高度なdapps向けのpasskeyスマートアカウントもサポートします。dappはPaliに対して、WebAuthnに裏付けられたスマートアカウントの作成とデプロイ、作成時のスポンサーpolicy付与、その後の`wallet_sendCalls`によるアトミックバッチ実行を要求できます。既存passkeyアカウントの復元はPali内で処理されます。

Pali の違いは、その組み合わせにあります。EVM と Syscoin UTXO の両方のフローを 1 つの拡張機能で扱い、Multicall3 と RPC バッチのフォールバックで高速に読み取り、通常アカウントとモジュール式スマートアカウントを並べて使えます。さらに、dapp 向けには MetaMask 互換の標準を提供し、署名、復元、アカウントポリシーは Pali サーバーではなく、ユーザー承認とオンチェーンモジュールで強制されるセルフカストディ型の安全モデルです。全体像は[Paliとは](./start-here/what-is-pali.md)を参照してください。

## 進む道を選ぶ

- **ユーザー**は[Getting started](./users/getting-started.md)から始めてください。
- **EVM開発者**は[Provider discovery](./developers/provider-discovery.md)と[EVM API overview](./evm-api/overview.md)から始めてください。
- **UTXOおよびSyscoin開発者**は[UTXO and Syscoin API overview](./utxo-syscoin-api/overview.md)から始めてください。
- **passkeysを利用する機関**は[Passkeys and institutions](./passkeys-institutions/overview.md)から始めてください。

## プロバイダーサーフェス

| プロバイダー | チェーンファミリー | 主な用途 |
| --- | --- | --- |
| `window.ethereum` | EVM | MetaMask互換のdapp連携、署名、トランザクション、権限、EIP-5792バッチ。 |
| `window.pali` | UTXO / Syscoin | Syscoin UTXOアカウント、PSBT署名、xpub/変更アドレスのワークフロー、アセットヘルパー。 |

## 重要なセーフティモデル

Paliは意図的に保守的に設計されています。dappsはホストごとに接続され、ブロッキング承認は直列化され、ネットワークタイプの不一致は明示的に処理され、ユーザーは拡張機能UIで重要な操作を承認します。多くのサイトを接続できますが、各サイトが同時に持てるアクティブな接続済みアカウントは1つです。
