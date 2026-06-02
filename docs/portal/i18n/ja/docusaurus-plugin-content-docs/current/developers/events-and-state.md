---
title: イベントとプロバイダー状態
---

ユーザーがアカウント、ネットワーク、ロック状態、UTXO状態を変更したときにアプリが同期を保てるよう、プロバイダーイベントをリッスンしてください。

## EVMイベント

```js
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('EVM accounts', accounts);
});

window.ethereum.on('chainChanged', (chainId) => {
  console.log('EVM chain', chainId);
});

window.ethereum.on('disconnect', (error) => {
  console.warn('Provider disconnected', error);
});
```

## Paliカスタムイベント

Paliは、拡張機能プロバイダーで使用されるカスタムウォレット通知も発行します。

| イベント | 意味 |
| --- | --- |
| `pali_accountsChanged` | 接続済みアカウントが変更されました。 |
| `pali_chainChanged` | アクティブチェーンが変更されました。 |
| `pali_unlockStateChanged` | ウォレットのロック状態が変更されました。 |
| `pali_isBitcoinBased` | アクティブなUTXOファミリーが変更されました。 |
| `pali_xpubChanged` | 接続済みUTXO xpubが変更されました。 |
| `pali_blockExplorerChanged` | アクティブなUTXO explorerが変更されました。 |

## プロバイダー状態メソッド

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

プロバイダー状態は初期化に役立ちますが、明示的なアカウント権限チェックの代替として扱わないでください。
