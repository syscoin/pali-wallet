---
title: Gas 与资金
---

智能账户授权和 gas 支付是分开的。验证器授权操作；有余额的钱包账户支付网络费用。当前 Pali 流程使用 wallet-paid gas 来部署、安装模块、执行 `wallet_sendCalls` 和 guardian recovery。除非未来 capability 明确报告 sponsorship，否则 dapp 不应承诺 gasless 流程。

## 通过 paymaster 支付 zkSYS gas

在 zkTanenbaum 等已配置网络上，Pali 可以通过 Pali paymaster 用 zkSYS 支付符合条件的智能账户发送成本。首次使用时可能需要一次性的 zkSYS 授权；该设置交易仍可能需要 native gas。如果 zkSYS sponsorship 是可选的，并且不可用、被用户拒绝，或对请求的操作不安全，Pali 会回退到 native gas。Dapp 应将其描述为可用时使用 zkSYS 支付智能账户 gas，而不是完全 gasless 的流程。
