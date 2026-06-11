---
title: 特性差异和限制
---

本页记录 dapp 应考虑的行为。

## 连接和弹窗

- 可以连接许多 dapp host。
- 每个 host 一次只有一个活跃的已连接账户。
- 阻塞式审批弹窗会被串行化并排队。
- 重复的活跃弹窗 route 可能会被拒绝。
- 弹窗 spam 可能会被临时阻止。

## UTXO 和 EVM 分离

- `window.ethereum` 用于 EVM。
- `window.pali` 用于 UTXO/Syscoin。
- 从错误链家族调用方法可能会失败，或需要网络切换。
- UTXO/EVM 切换可能会断开连接并要求重新连接。

## EIP-5792 状态

- `wallet_sendCalls` 已实现。
- `wallet_getCapabilities` 已实现。
- `wallet_getCallsStatus` 已实现；未知 bundle id 以错误 `5730` 失败。
- `wallet_showCallsStatus` 已实现，会在钱包弹窗中显示批量状态。

## 原子性

- Passkey 智能账户可以通过一次智能账户执行来执行选定的批量调用。
- 普通 EOA 批量调用是顺序的钱包发送，不应被视为真正的 atomic execution。

## 订阅

不支持 `eth_subscribe` 和 `eth_unsubscribe`。请使用专用 WebSocket RPC provider 进行实时链订阅。

## Passkey

- Passkey 智能账户支持要求活跃链上存在 Pali factory 和模块。在支持 canonical CREATE2 的兼容 EVM 链上，Pali 可以通过 Settings > Advanced > **Smart account setup** 部署该设置。
- 通过 Passkey `wallet_sendCalls` 不支持合约部署调用。
- `policyText` 是钱包元数据和显示文本，不是链上执行。
- 当前智能账户执行使用 wallet-paid gas，除非未来 capability 明确报告 sponsorship。

## Iframe

Pali 会将 provider 注入顶层页面，而不是 iframe。
