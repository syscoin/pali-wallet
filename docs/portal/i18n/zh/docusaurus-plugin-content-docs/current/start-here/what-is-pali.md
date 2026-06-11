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

## Pali v4 的新特性

Pali v4 围绕三个理念对钱包进行了彻底的现代化重构：速度、标准和灵活的签名权限。

- **处处更快。** Pali 在 EVM 和 UTXO 网络上批量处理 RPC 流量，余额、历史和手续费数据只需更少的往返即可加载。结果是一个让人感觉即时响应、而不是忙碌等待的钱包。
- **基于标准的智能账户。** Pali 智能账户遵循 ERC-7579 模块模型，并使用 ERC-4337 风格的执行编码。账户没有任何私有锁定：验证器、执行器和账户行为都遵循公开规范。
- **授权与账户分离。** 谁能签名是模块层面的决定，而不是固化进地址的属性。今天这意味着钱包持有的 ECDSA 密钥和 P-256 WebAuthn passkeys。未来则可以是新的验证器类型——包括后量子签名方案——安装在同一账户、同一地址上，逐笔交易的授权可以完全不涉及 ECDSA。
- **可组合的签名策略。** 组合验证器把子验证器组合在一个阈值之下：1-of-N 追求便利，t-of-N 适合共享控制，N-of-N 提供最高保障。组合可以嵌套，因此策略可以是分层的。
- **Guardians 防止失去访问权。** Guardian recovery 是一个独立的执行器角色模块（遵循 ERC-7579），与验证器刻意区分。Guardians 不能签署交易；他们只能排程一次带时间锁的验证器替换。在账户状态正常时，可以随时添加或移除 guardians。

## Pali 的发展方向

Pali 的方向是**为加密前端提供动态而灵活的签名权限**。任何前端——dapp、交易所、机构仪表盘、嵌入式服务——都应当能向钱包请求恰好符合任务需要的签名策略：用 passkey 实现轻松引导，用 t-of-N 组合策略管理共享金库，用硬件支持的 guardian 做恢复，或使用尚不存在的未来验证器类型。账户地址保持稳定，而背后的权限不断演进。

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
