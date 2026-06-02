---
title: 事件和 provider 状态
---

监听 provider 事件，以便在用户更改账户、网络、锁定状态或 UTXO 状态时让你的应用保持同步。

## EVM 事件

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

## Pali 自定义事件

Pali 还会发出扩展 provider 使用的自定义钱包通知。

| 事件 | 含义 |
| --- | --- |
| `pali_accountsChanged` | 已连接账户已更改。 |
| `pali_chainChanged` | 活跃链已更改。 |
| `pali_unlockStateChanged` | 钱包锁定状态已更改。 |
| `pali_isBitcoinBased` | 活跃 UTXO 家族已更改。 |
| `pali_xpubChanged` | 已连接 UTXO xpub 已更改。 |
| `pali_blockExplorerChanged` | 活跃 UTXO explorer 已更改。 |

## Provider 状态方法

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

Provider 状态对初始化很有用，但不要将其作为显式账户权限检查的替代品。
