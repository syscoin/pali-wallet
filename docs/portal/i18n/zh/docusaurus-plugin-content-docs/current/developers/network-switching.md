---
title: 网络切换
---

Pali 支持 EVM 网络切换、EVM 链添加、UTXO 链切换，以及 UTXO/EVM 家族切换。

## 添加 EVM 链

```js
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [
    {
      chainId: '0x39',
      chainName: 'Syscoin NEVM',
      nativeCurrency: { name: 'Syscoin', symbol: 'SYS', decimals: 18 },
      rpcUrls: ['https://rpc.syscoin.org'],
      blockExplorerUrls: ['https://explorer.syscoin.org'],
    },
  ],
});
```

## 切换 EVM 链

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## 在 UTXO 和 EVM 家族之间切换

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

## dapp 指南

将网络切换视为用户批准。避免在页面加载时切换。只有在用户发起需要目标网络的操作之后才请求切换。
