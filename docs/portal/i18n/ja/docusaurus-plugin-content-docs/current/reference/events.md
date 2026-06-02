---
title: イベント
---

プロバイダーを選択した後、イベントを購読してください。

## EIP-1193イベント

| イベント | プロバイダー | 意味 |
| --- | --- | --- |
| `connect` | `window.ethereum` | プロバイダーが接続されました。 |
| `disconnect` | `window.ethereum` | プロバイダーが切断されました。 |
| `accountsChanged` | `window.ethereum` | EVMアカウント一覧が変更されました。 |
| `chainChanged` | `window.ethereum` | EVMチェーンが変更されました。 |
| `message` | `window.ethereum` | プロバイダーメッセージ。 |

## Paliウォレット通知

| イベント | 意味 |
| --- | --- |
| `pali_accountsChanged` | 接続済みアカウントが変更されました。 |
| `pali_chainChanged` | アクティブチェーンが変更されました。 |
| `pali_unlockStateChanged` | ウォレットのロック状態が変更されました。 |
| `pali_isBitcoinBased` | アクティブなUTXOファミリー状態が変更されました。 |
| `pali_xpubChanged` | 接続済みUTXO xpubが変更されました。 |
| `pali_blockExplorerChanged` | アクティブなblock explorerが変更されました。 |
| `walletUpdate` | ウォレット状態更新通知。 |

## 例

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

重複した状態更新を避けるため、コンポーネントのunmount時にリスナーを削除してください。
