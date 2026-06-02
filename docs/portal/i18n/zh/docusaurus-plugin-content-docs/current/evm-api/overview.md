---
title: EVM API 概览
---

Pali 的 EVM provider 通过 `window.ethereum` 暴露，并兼容标准 MetaMask 风格的 dapp 集成。

## 常用方法

| 领域 | 方法 |
| --- | --- |
| 连接 | `eth_requestAccounts`, `eth_accounts` |
| 网络 | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| 交易 | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| 签名 | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| 权限 | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| 资产 | `wallet_watchAsset` |
| 批量操作 | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkey | `wallet_createPasskeyAccount` |

## Provider 请求形状

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## 只读 RPC 代理

Pali 会将许多只读 Ethereum JSON-RPC 方法转发到活跃 RPC provider，包括 block、transaction、receipt、log、fee、balance、code、storage 和 proof 查询。

## 不支持的订阅

钱包内 provider 不支持 `eth_subscribe` 和 `eth_unsubscribe`。对于大量依赖订阅的应用状态，请使用你自己的 WebSocket RPC provider。
