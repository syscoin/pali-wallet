---
title: Bitcoin 风格 dapp
---

Pali 的 UTXO provider 使 Bitcoin 风格账户流程的浏览器 dapp 成为可能，包括 Syscoin UTXO 和兼容的交易模型。

## 与 EVM 相比有什么变化

EVM dapp 通常要求一个账户签署一个交易对象。UTXO dapp 通常会：

1. 读取账户和 UTXO 状态。
2. 构建 PSBT。
3. 包含找零地址。
4. 请求钱包签名。
5. 完成并广播。

## 最小集成形状

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## 最佳实践

- 确定性地构建 PSBT，并在你的应用中向用户显示交易摘要。
- 使用 Pali 的找零地址，而不是重复使用接收地址。
- 处理 testnet/mainnet 差异。
- 处理钱包锁定、拒绝和网络不匹配错误。
- 避免在用户发起有意义操作之前请求 xpub 或签名。
