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

请传入结构化 Pali PSBT 对象，而非原始 Base64 字符串。`syscoinjs-lib` 导出 `{ psbt: <base64>, assets: <JSON 字符串> }`；适用时请提供资产映射。`sys_sign` 返回相同格式的签名对象，该对象可能仍为部分签名。 返回的 `assets` 字段为空；请单独保留所需的资产元数据。

```js
import { utils as sys } from 'syscoinjs-lib';

const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

// Supply your constructed syscoinjs PSBT and optional asset map.
const paliPsbt = sys.exportPsbtToJson(psbt, assetsMap);
const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [paliPsbt],
});
```

## 最佳实践

- 确定性地构建 PSBT，并在你的应用中向用户显示交易摘要。
- 使用 Pali 的找零地址，而不是重复使用接收地址。
- 处理 testnet/mainnet 差异。
- 处理钱包锁定、拒绝和网络不匹配错误。
- 避免在用户发起有意义操作之前请求 xpub 或签名。
