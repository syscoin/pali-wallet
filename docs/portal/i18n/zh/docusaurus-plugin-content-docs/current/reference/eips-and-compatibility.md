---
title: EIP 和兼容性
---

Pali 旨在支持真实 dapp 使用的钱包标准，同时增加 UTXO 和 Passkey 能力。

## EVM 钱包标准

| 标准 | Pali 支持 |
| --- | --- |
| EIP-1193 | 通过 `window.ethereum` 提供 provider 请求/事件/错误。 |
| EIP-6963 | 多钱包发现和 provider 公告。 |
| EIP-1102 | `enable()` 已弃用，应改用账户请求方法。 |
| EIP-1474 | Ethereum RPC 的 JSON-RPC 风格错误码。 |
| EIP-2255 | 钱包权限方法。 |
| EIP-3085 | `wallet_addEthereumChain`。 |
| EIP-3326 | `wallet_switchEthereumChain`。 |
| EIP-5792 | `wallet_sendCalls`、`wallet_getCapabilities`、状态兼容方法。 |
| EIP-712 | 通过 `eth_signTypedData_v4` 和相关方法进行 typed data 签名。 |
| EIP-747 | `wallet_watchAsset`。 |

## MetaMask 兼容性

Pali 为期望 MetaMask 风格行为的 dapp 暴露 `window.ethereum`。它还将 provider 标记为兼容 MetaMask，以支持旧集成，并通过 EIP-6963 宣告自身以支持现代钱包选择。

## Pali 在 EVM 之外的扩展

Pali 为 UTXO/Syscoin 流程增加了 `window.pali`。这些方法不是 Ethereum EIP；它们是 Pali 面向 UTXO 账户状态、PSBT 签名、Syscoin 资产和 Bitcoin 风格 dapp 流程的浏览器钱包 API。

## 兼容性注意事项

- 扩展 provider 不支持 EVM 订阅。
- `wallet_getCallsStatus` 和 `wallet_showCallsStatus` 是兼容性 stub。
- EOA `wallet_sendCalls` 执行是顺序执行，不是真正的链上原子性。
- UTXO 和 EVM 网络家族通过 provider 表面和钱包状态分离。
