---
title: 错误
---

始终用 `try` / `catch` 包裹 provider 请求。Pali 会尽可能使用标准 JSON-RPC 和 EIP-1193 风格错误，并为不支持的网络、硬件钱包限制和 Passkey 状态提供钱包特定错误。

```js
try {
  await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx],
  });
} catch (error) {
  switch (error.code) {
    case 4001:
      console.log('User rejected the request.');
      break;
    case 4100:
      console.log('The dapp is not authorized.');
      break;
    case 4200:
      console.log('The method is unsupported.');
      break;
    default:
      console.error(error);
  }
}
```

## 常见类别

| 代码 | 含义 |
| --- | --- |
| `4001` | 用户拒绝了请求。 |
| `4100` | 未授权的账户或方法。 |
| `4101` | 方法仅适用于不同的链家族。 |
| `4200` | 不支持的方法。 |
| `4900` | Provider 已断开连接。 |
| `4901` | Provider 已从请求的链断开连接。 |
| `5710` | 钱包中未为该 EIP-5792 bundle 所在链配置 RPC（`wallet_getCallsStatus` / `wallet_showCallsStatus`）。 |
| `5720` | `wallet_sendCalls` 中 dapp 提供的 EIP-5792 bundle id 重复。 |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus` 中的未知 EIP-5792 bundle id。 |

更多参考请参阅 [错误码](../reference/error-codes.md)。
