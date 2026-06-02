---
title: 连接账户
---

Pali 连接请求是明确的用户批准。dapp 应只在用户点击连接按钮时请求访问。

## EVM 连接

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXO 连接

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## 读取连接状态

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## 每个 dapp 一个活跃账户

Pali 可以让许多 dapp origin 保持连接。对于单个 origin，Pali 会跟踪一个活跃的已连接账户。如果敏感请求引用了不同的 `from` 地址，Pali 可能会要求用户切换 dapp 连接。

## 断开连接

对于 EVM 权限，`wallet_revokePermissions` 会将 dapp 从 Pali 断开。

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
