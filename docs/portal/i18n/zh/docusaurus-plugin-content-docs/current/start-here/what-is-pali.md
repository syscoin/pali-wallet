---
title: 什么是 Pali？
---

Pali Wallet 是官方 Syscoin 钱包扩展，也是面向 EVM 兼容链的通用 web3 钱包。它为三类有交集的受众而设计：

- **普通用户**，希望获得用于 EVM、Syscoin、Rollux 和 UTXO 资产的安全浏览器钱包。
- **Dapp 开发者**，希望在同一扩展中同时获得兼容 MetaMask 的 EVM 访问和 UTXO 访问。
- **机构**，需要 Passkey 智能账户、账户恢复、模块策略和由 dapp 驱动的引导流程。

## Pali 的不同之处

大多数浏览器钱包只暴露 EVM provider。Pali 暴露两个互补的表面：

- `window.ethereum` 用于 EVM dapp，并有意兼容常见 MetaMask 流程。
- `window.pali` 用于 Syscoin UTXO 和 Bitcoin 风格流程。

这让 dapp 能够构建跨越基于账户和基于 UTXO 的链的体验，而无需要求用户安装不同的钱包。

## Pali 有什么不同？

Pali 围绕一个理念构建：钱包应该是用户的安全边界，而不是服务器。Pali 可以像任何浏览器钱包一样从 RPC 节点、explorer 和 indexer 读取数据，但托管、批准、恢复和账户策略都留在用户密钥与链上模块中。

- **没有托管或恢复服务器。** Pali 不保存服务器端密钥、云端加密数据、策略引擎或恢复后门。敏感操作在扩展中批准，由用户的钱包、passkey、硬件设备或智能账户验证器签名，并由链执行。
- **带 fallback 的快速读取。** 当 Pali 需要大量 EVM 合约读取时，会先尝试 Multicall3 `aggregate3`：一次链上 `eth_call`、同一 block 的视图，以及每个 call 的失败隔离。如果 Multicall3 未部署或 RPC 拒绝，Pali 会 fallback 到 JSON-RPC batch；如果 batch 不可用，则再 fallback 到单独调用。
- **一个钱包支持两类 chain。** Pali 为 EVM dapp 暴露 MetaMask 兼容的 `window.ethereum`，为 Syscoin UTXO / Bitcoin-style 流程暴露 `window.pali`。dapp 可以在一个扩展中处理基于账户的资产、UTXO、PSBT 和 xpub。
- **普通账户和智能账户。** 用户可以并排使用普通 EOA-style 账户、硬件钱包账户和 Pali 智能账户。普通账户简单且便携。智能账户增加可编程策略：passkey、钱包持有的 ECDSA 验证器、组合阈值策略、guardian recovery 和自定义模块。
- **标准优先的 dapp 集成。** Pali 遵循 dapp 已经使用的钱包 API：EIP-1193、EIP-6963、EIP-2255 permissions、EIP-5792 `wallet_sendCalls`、EIP-712 typed data，以及 MetaMask 兼容的 request behavior。Pali 智能账户使用 ERC-7579-style validator/executor modules 和 ERC-4337-style execution data。
- **可编程授权。** 在 Pali 智能账户中，地址保持稳定，但签名策略可以演进。验证器决定谁可以批准操作；执行器添加 guardian recovery 等功能。团队可以从 passkey 切换到阈值策略，添加恢复，或采用新的验证器类型，而无需移动资金。
- **面向未来更强签名设计。** 因为授权是模块化的，未来验证器可以支持 ECDSA 和 P-256 passkey 之外的方案，包括当目标 chain 上可行时的后量子签名设计。
- **安全优先于便利。** Pali 串行化阻塞式批准，检查已连接站点和网络上下文，阻止发送和批准中的高风险 blacklist 命中，并将 guardian recovery 与交易签名分离。Guardians 可以在延迟后帮助恢复访问权；他们不能悄悄花费资金。

Pali 的方向是**为真实用户和真实 dapp 提供自托管可编程账户**：足够快，可用于日常钱包使用；足够标准，方便开发者；足够灵活，适合机构；也足够保守，让关键安全控制留在用户和链上。

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
| Passkey 智能账户创建 | `wallet_prepareSmartAccount` |

## 当前 Passkey 范围

Pali 智能账户可在 Pali 使用地址上已经存在 Pali factory 和模块的 EVM 网络上使用。此 Pali 构建配置了 `zkTanenbaum` 测试网（`57057`），zkSYS 生产支持会在生产地址配置后使用相同架构。

该基础设施并不限于 Pali 运营的链。在支持 canonical CREATE2 的兼容 EVM 网络上，Pali 可以直接在钱包内部署所需的智能账户设置：打开 Pali Settings，进入 Advanced，并在 **Smart account setup** 中使用 Deploy 按钮。Passkey 验证器需要 P-256 WebAuthn 验证，许多现代 EVM 环境通过 P-256/passkey precompile 提供该能力。
