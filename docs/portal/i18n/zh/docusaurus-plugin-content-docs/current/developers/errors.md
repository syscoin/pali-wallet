---
title: 错误
---

提供程序请求始终应放在 `try` / `catch` 中。Pali 会尽可能使用标准 JSON-RPC 和 EIP-1193 风格的错误，并为不受支持的网络、硬件钱包限制和通行密钥状态提供钱包特定错误。

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
| `4100` | 未获授权的账户或方法。 |
| `4101` | 该方法仅适用于其他链类型。 |
| `4200` | 不支持的方法。 |
| `4900` | 提供程序已断开连接。 |
| `4901` | 提供程序与请求的链断开了连接。 |
| `5710` | EIP-5792 批次所在的链未在钱包中配置 RPC（`wallet_getCallsStatus` / `wallet_showCallsStatus`）。 |
| `5720` | `wallet_sendCalls` 中由 dapp 提供的 EIP-5792 批次 id 重复。 |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus` 中的 EIP-5792 批次 id 未知。 |

完整说明请参阅[错误代码](../reference/error-codes.md)。

## 重试中断的请求

超时、批准窗口关闭或连接丢失，并不总能证明交易从未提交。再次请求签名或提交之前，请检查任何已知的交易哈希、交易历史记录或批次状态。即使随后更新本地历史记录失败，已获确认的广播仍然成功。

可以在适当情况下重试普通读取，但结果不确定时，不要自动重放签名、钱包创建或广播请求。如果账户或网络已变更，请为当前上下文重新取得批准。对于待完成的智能账户设置，请先在原网络检查其状态，再尝试再次部署。
