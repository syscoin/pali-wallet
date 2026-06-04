---
title: メソッド一覧
---

このリファレンスは、Paliの現在のメソッドレジストリとプロバイダーから文書化された、公開dapp向けメソッドを要約します。

## ウォレットメソッド

| メソッド | サーフェス | 目的 | ポップアップ |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | ロック状態を読み取ります。 | いいえ |
| `wallet_isConnected` | EVM / UTXO | サイト接続状態を読み取ります。 | いいえ |
| `wallet_getAccount` | EVM / UTXO | 接続済みアカウントオブジェクトを読み取ります。 | いいえ |
| `wallet_getAddress` | EVM / UTXO | 接続済みアドレスを読み取ります。 | いいえ |
| `wallet_getPublicKey` | EVM / UTXO | 公開鍵を読み取ります。 | いいえ |
| `wallet_getBalance` | EVM / UTXO | 残高を読み取ります。 | いいえ |
| `wallet_getChangeAddress` | UTXO | 変更アドレスを読み取ります。 | いいえ |
| `wallet_getNetwork` | EVM / UTXO | アクティブネットワークを読み取ります。 | いいえ |
| `wallet_getTokens` | EVM / UTXO | トークン保有状況を読み取ります。 | いいえ |
| `wallet_estimateFee` | EVM / UTXO | feesを見積もります。 | いいえ |
| `wallet_getProviderState` | EVM | EVMプロバイダー状態を初期化します。 | いいえ |
| `wallet_getSysProviderState` | UTXO | UTXOプロバイダー状態を初期化します。 | いいえ |
| `wallet_getSysAssetMetadata` | UTXO | Syscoinアセットメタデータを読み取ります。 | いいえ |
| `wallet_changeAccount` | EVM / UTXO | 接続済みアカウントを変更します。 | はい |
| `wallet_requestPermissions` | EVM | EIP-2255権限をリクエストします。 | はい |
| `wallet_getPermissions` | EVM | EIP-2255権限を読み取ります。 | いいえ |
| `wallet_revokePermissions` | EVM | 権限を取り消して切断します。 | いいえ |
| `wallet_watchAsset` | EVM | アセット監視をリクエストします。 | はい |
| `wallet_addEthereumChain` | EVM | EVMチェーンを追加します。 | はい |
| `wallet_switchEthereumChain` | EVM | EVMチェーンを切り替えます。 | はい |
| `wallet_createPasskeyAccount` | EVM | passkeyスマートアカウントを作成してデプロイします。 | はい |
| `wallet_sendCalls` | EVM | EIP-5792バッチリクエストを送信します。 | はい |
| `wallet_getCapabilities` | EVM | アカウントcapabilitiesを読み取ります。 | いいえ |
| `wallet_getCallsStatus` | EVM | 互換性stub。不明なidsはエラーになります。 | いいえ |
| `wallet_showCallsStatus` | EVM | 互換性stub。`null`を返します。 | いいえ |

## EVMメソッド

| メソッドグループ | メソッド |
| --- | --- |
| アカウント | `eth_requestAccounts`, `eth_accounts` |
| トランザクション | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| 署名 | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| ネットワーク | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| チェーンデータ | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, block and transaction lookup methods |
| ノードデータ | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## UTXOとSyscoinメソッド

| メソッド | 目的 |
| --- | --- |
| `sys_requestAccounts` | UTXOアカウントを接続します。 |
| `sys_getAccount` | アカウント詳細を読み取ります。 |
| `sys_isConnected` | 接続状態を読み取ります。 |
| `sys_getNetwork` | UTXOネットワークを読み取ります。 |
| `sys_getPublicKey` | 公開鍵を読み取ります。 |
| `sys_getCurrentAddressPubkey` | 現在のアドレスpubkeyを読み取ります。 |
| `sys_getBip32Path` | 派生pathを読み取ります。 |
| `sys_getChangeAddress` | 変更アドレスを読み取ります。 |
| `sys_getTransactions` | トランザクションを読み取ります。 |
| `sys_transaction` | トランザクションを読み取ります。 |
| `sys_sign` | PSBTに署名します。 |
| `sys_signAndSend` | 署名してブロードキャストします。 |
| `sys_isValidSYSAddress` | Syscoinアドレスを検証します。 |
| `sys_changeUTXOEVM` | チェーンファミリーを切り替えます。 |
| `sys_switchChain` | UTXOチェーンを切り替えます。 |

## `_sys`ヘルパー

| ヘルパー | 目的 |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | ユーザーがmintしたSyscoinトークンを読み取ります。 |
| `window.pali._sys.getHoldingsData()` | トークン保有状況を読み取ります。 |
| `window.pali._sys.getConnectedAccountXpub()` | 接続済みxpubを読み取ります。 |
| `window.pali._sys.getChangeAddress()` | 変更アドレスを読み取ります。 |
| `window.pali._sys.getDataAsset(assetGuid)` | Syscoin data assetを読み取ります。 |
