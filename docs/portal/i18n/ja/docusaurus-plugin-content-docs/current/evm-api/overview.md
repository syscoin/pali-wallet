---
title: EVM API概要
---

PaliのEVMプロバイダーは`window.ethereum`を通じて公開され、標準的なMetaMaskスタイルのdapp連携と互換性があります。

## 一般的なメソッド

| 領域 | メソッド |
| --- | --- |
| 接続 | `eth_requestAccounts`, `eth_accounts` |
| ネットワーク | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| トランザクション | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| 署名 | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| 権限 | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| アセット | `wallet_watchAsset` |
| バッチ | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkeys | `wallet_createPasskeyAccount` |

## プロバイダーリクエストの形

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## 読み取り専用RPCプロキシ

Paliは、ブロック、トランザクション、receipt、log、fee、balance、code、storage、proofクエリを含む多くの読み取り専用Ethereum JSON-RPCメソッドを、アクティブなRPCプロバイダーへ転送します。

## 未サポートのサブスクリプション

`eth_subscribe`と`eth_unsubscribe`はウォレット内プロバイダーではサポートされていません。サブスクリプションを多用するアプリケーション状態には、独自のWebSocket RPCプロバイダーを使用してください。
