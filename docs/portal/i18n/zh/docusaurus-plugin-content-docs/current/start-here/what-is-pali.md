---
title: 什么是 Pali？
---

Pali Wallet 是官方 Syscoin 钱包扩展，也是面向 EVM 兼容链的通用 web3 钱包。它为三类有交集的受众而设计：

- **普通用户**，希望获得用于 EVM、Syscoin、Rollux 和 UTXO 资产的安全浏览器钱包。
- **Dapp 开发者**，希望在同一扩展中同时获得兼容 MetaMask 的 EVM 访问和 UTXO 访问。
- **机构**，需要 Passkey 智能账户、账户恢复、sponsor 策略和由 dapp 驱动的引导流程。

## Pali 的不同之处

大多数浏览器钱包只暴露 EVM provider。Pali 暴露两个互补的表面：

- `window.ethereum` 用于 EVM dapp，并有意兼容常见 MetaMask 流程。
- `window.pali` 用于 Syscoin UTXO 和 Bitcoin 风格流程。

这让 dapp 能够构建跨越基于账户和基于 UTXO 的链的体验，而无需要求用户安装不同的钱包。

## 兼容性概览

| 能力 | 支持的表面 |
| --- | --- |
| EIP-1193 provider 请求 | `window.ethereum` |
| EIP-6963 钱包发现 | `window.ethereum` provider announcement |
| 账户权限 | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| EVM 交易和签名 | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, 相关签名方法 |
| EIP-5792 批量请求 | `wallet_sendCalls`, `wallet_getCapabilities` |
| UTXO 账户和 xpub 状态 | `window.pali` 和 `sys_*` 方法 |
| PSBT 签名和广播 | `sys_sign`, `sys_signAndSend` |
| Passkey 智能账户创建 | `wallet_createPasskeyAccount` |

## 当前 Passkey 范围

Passkey 智能账户仅在 zkSYS 系列 EVM 网络上可用，在这些网络中 Pali 已配置 Passkey factory 合约，且链支持 P-256 WebAuthn 证明验证。此 Pali 构建配置了 `zkTanenbaum` 测试网（`57057`）。一旦生产 factory 地址在 Pali 中配置完成，zkSYS 生产支持会使用相同架构。dapp 应检查能力，并干净地处理不支持的链。
