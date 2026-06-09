---
title: 安全模型
---

Pali 是非托管钱包。它不会向 dapp 暴露私钥。dapp 向注入的 provider 发送请求，Pali 验证并路由这些请求，用户在扩展 UI 中批准敏感操作。

## 核心原则

- **按 origin 限定的连接：** 连接按 dapp host 存储。
- **每个 dapp 一个活跃账户：** 一个已连接站点一次只有一个活跃账户，即使许多站点都可以保持连接。
- **串行化审批：** 会打开弹窗的阻塞请求会被协调，避免用户被相互竞争的审批淹没。
- **网络家族检查：** EVM 方法和 UTXO 方法相互分离。错误家族的调用应作为可恢复的 dapp 错误处理。
- **显式签名：** 交易、PSBT、typed data、消息签名、Passkey 创建、Passkey 执行、资产 watch 请求和链变更都需要正确的钱包状态和用户批准。
- **Provider 隔离：** Pali 将 provider 注入顶层页面。它不会注入 iframe。

## dapp 会收到什么

dapp 会收到公开账户标识符、provider 状态、签名、交易哈希和显式 RPC 结果。它们永远不会收到 seed phrase、私钥、Passkey 私有材料或 authenticator secret。

## Passkey 安全性

Passkey 智能账户使用 WebAuthn 凭证。Pali 存储公开元数据和凭证标识符；私钥材料保留在 authenticator 内部。Pali 会拒绝跨 origin 的 WebAuthn assertion，并验证 Passkey action hash 与已准备的交易集合相匹配。

## Sponsor 策略安全性

机构 模块策略分为：

- **链上策略：** mode、sponsor signer 和 sponsor URL。
- **钱包元数据：** 显示用策略文本和其他本地钱包上下文。

`policyText` 字段会作为上下文展示给用户。它不是链上执行原语。
