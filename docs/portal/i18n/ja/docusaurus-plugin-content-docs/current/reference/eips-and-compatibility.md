---
title: EIPsと互換性
---

Paliは、実際のdappsが使用するウォレット標準をサポートしつつ、UTXOとpasskey機能を追加することを目指しています。

## EVMウォレット標準

| 標準 | Paliサポート |
| --- | --- |
| EIP-1193 | `window.ethereum`を通じたプロバイダーリクエスト/イベント/エラー。 |
| EIP-6963 | マルチウォレットディスカバリーとプロバイダーアナウンス。 |
| EIP-1102 | `enable()`はアカウントリクエストメソッドを優先して非推奨です。 |
| EIP-1474 | Ethereum RPC向けJSON-RPCスタイルのエラーコード。 |
| EIP-2255 | ウォレット権限メソッド。 |
| EIP-3085 | `wallet_addEthereumChain`。 |
| EIP-3326 | `wallet_switchEthereumChain`。 |
| EIP-5792 | `wallet_sendCalls`、`wallet_getCapabilities`、ステータス互換メソッド。 |
| EIP-712 | `eth_signTypedData_v4`および関連メソッドを通じたtyped data署名。 |
| EIP-747 | `wallet_watchAsset`。 |

## MetaMask互換性

Paliは、MetaMaskスタイルの動作を期待するdapps向けに`window.ethereum`を公開します。また、レガシー連携向けにプロバイダーをMetaMask互換として示し、現代的なウォレット選択向けにEIP-6963を通じて自身をアナウンスします。

## EVMを超えるPali拡張

PaliはUTXO/Syscoinフロー向けに`window.pali`を追加します。これらのメソッドはEthereum EIPsではありません。UTXOアカウント状態、PSBT署名、Syscoinアセット、Bitcoinスタイルのdappフロー向けのPaliブラウザウォレットAPIです。

## 互換性の注意点

- EVMサブスクリプションは拡張機能プロバイダーでサポートされていません。
- `wallet_getCallsStatus`と`wallet_showCallsStatus`はEIP-5792に準拠して実装されています。
- EOAの`wallet_sendCalls`実行は順次であり、真のオンチェーンアトミック性ではありません。
- UTXOとEVMのネットワークファミリーは、プロバイダーサーフェスとウォレット状態によって分離されています。
