---
title: 权限
---

Pali 为 EVM dapp 支持 EIP-2255 风格权限。

## 请求权限

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

大多数 dapp 可以改用 `eth_requestAccounts`。当你需要显式权限对象和已允许链的元数据时，使用 `wallet_requestPermissions`。

## 获取权限

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## 撤销权限

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

在 Pali 中，撤销会将 dapp 从钱包断开。应将其视为完整的站点断开，而不是细粒度的部分权限编辑。

## 账户切换

对于交易发送和签名等阻塞方法，Pali 会检查已连接的 dapp 账户是否与 dapp 请求的账户匹配。如果 dapp 发送的 `from` 地址不是活跃的已连接账户，Pali 可能会提示用户切换 dapp 连接。
