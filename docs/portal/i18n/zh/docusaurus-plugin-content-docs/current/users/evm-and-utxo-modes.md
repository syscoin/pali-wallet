---
title: EVM 和 UTXO 模式
---

Pali 支持基于账户的 EVM 网络和基于 UTXO 的网络。由于账户模型有根本差异，扩展使用分离的 provider 表面。

## EVM 模式

EVM 模式用于使用 `window.ethereum` 的 dapp。它支持 MetaMask 风格的账户请求、交易、签名、权限、token watch 请求和网络管理。

示例：

- Rollux 和 Syscoin NEVM dapp
- ERC-20、ERC-721 和 ERC-1155 交互
- EIP-712 typed data 签名
- Passkey 智能账户创建和执行

## UTXO 模式

UTXO 模式用于使用 `window.pali` 的 dapp。它支持 Syscoin UTXO 账户状态、感知 xpub 的集成、PSBT 签名、交易广播和 SPT 资产流程。

示例：

- Syscoin UTXO 资产应用
- 类 Bitcoin 的 PSBT 工作流
- 需要找零地址的 dapp
- 读取 UTXO 交易历史的 dapp

## 切换模式

如果 dapp 请求错误链家族的方法，Pali 可能要求切换网络。dapp 应干净地处理这些错误，并引导用户进入正确网络。

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

在 UTXO 和 EVM 上下文之间切换可能需要重新连接 dapp，因为活跃账户家族会发生变化。
