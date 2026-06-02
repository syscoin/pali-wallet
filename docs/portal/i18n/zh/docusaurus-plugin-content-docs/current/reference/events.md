---
title: 事件
---

选择 provider 后订阅事件。

## EIP-1193 事件

| 事件 | Provider | 含义 |
| --- | --- | --- |
| `connect` | `window.ethereum` | Provider 已连接。 |
| `disconnect` | `window.ethereum` | Provider 已断开连接。 |
| `accountsChanged` | `window.ethereum` | EVM 账户列表已更改。 |
| `chainChanged` | `window.ethereum` | EVM 链已更改。 |
| `message` | `window.ethereum` | Provider 消息。 |

## Pali 钱包通知

| 事件 | 含义 |
| --- | --- |
| `pali_accountsChanged` | 已连接账户已更改。 |
| `pali_chainChanged` | 活跃链已更改。 |
| `pali_unlockStateChanged` | 钱包锁定状态已更改。 |
| `pali_isBitcoinBased` | 活跃 UTXO 家族状态已更改。 |
| `pali_xpubChanged` | 已连接 UTXO xpub 已更改。 |
| `pali_blockExplorerChanged` | 活跃 block explorer 已更改。 |
| `walletUpdate` | 钱包状态更新通知。 |

## 示例

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

在组件卸载时移除监听器，以避免重复状态更新。
