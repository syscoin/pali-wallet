---
title: 欢迎使用 Pali Wallet
slug: /
---

Pali Wallet 是一款浏览器扩展钱包，面向需要在同一安全层中同时访问基于账户和基于 UTXO 的区块链的用户与应用。

对于 EVM dapp，Pali 暴露一个兼容 MetaMask 的 `window.ethereum` provider，支持 EIP-1193 请求、EIP-6963 发现、账户权限、链切换、签名、交易和批量调用。对于 Syscoin UTXO 和 Bitcoin 风格应用，Pali 暴露 `window.pali`，提供账户、xpub、找零地址、PSBT 签名、交易和资产方法。

Pali 还为机构和高级 dapp 支持 Passkey 智能账户。dapp 可以请求 Pali 创建并部署由 WebAuthn 支持的智能账户，在创建期间附加 模块策略，并随后通过 `wallet_sendCalls` 执行原子批量操作。现有 Passkey 账户的恢复在 Pali 中处理。

Pali v4 围绕速度和灵活的签名权限重构了钱包：在 EVM 和 UTXO 网络上批量处理 RPC 流量，让 UI 显著更快；智能账户遵循 ERC-7579 / ERC-4337 标准；并采用模块化授权模型——验证器（可以签名）和 guardians（可以恢复）是同一个稳定账户地址上彼此独立、可升级的角色。完整介绍见 [什么是 Pali？](./start-here/what-is-pali.md)。

## 选择你的路径

- **用户** 应从 [入门指南](./users/getting-started.md) 开始。
- **EVM 开发者** 应从 [Provider 发现](./developers/provider-discovery.md) 和 [EVM API 概览](./evm-api/overview.md) 开始。
- **UTXO 和 Syscoin 开发者** 应从 [UTXO 和 Syscoin API 概览](./utxo-syscoin-api/overview.md) 开始。
- **使用 Passkey 的机构** 应从 [Passkey 与机构](./passkeys-institutions/overview.md) 开始。

## Provider 表面

| Provider | 链家族 | 主要用途 |
| --- | --- | --- |
| `window.ethereum` | EVM | 兼容 MetaMask 的 dapp 集成、签名、交易、权限和 EIP-5792 批量操作。 |
| `window.pali` | UTXO / Syscoin | Syscoin UTXO 账户、PSBT 签名、xpub/找零地址工作流和资产辅助功能。 |

## 重要安全模型

Pali 有意保持保守。dapp 按 host 建立连接，会阻塞的审批会被串行化，网络类型不匹配会被显式处理，用户会在扩展 UI 中批准敏感操作。许多站点可以同时保持连接，但每个站点一次只有一个活跃的已连接账户。
