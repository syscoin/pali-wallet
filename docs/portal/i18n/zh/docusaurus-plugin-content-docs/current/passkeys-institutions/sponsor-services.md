---
title: Gas 与资金
---

智能账户授权和 gas 支付是分开的。验证器授权操作；有余额的钱包账户支付网络费用。当前 Pali 流程使用 wallet-paid gas 来部署、安装模块、执行 `wallet_sendCalls` 和 guardian recovery。除非未来 capability 明确报告 sponsorship，否则 dapp 不应承诺 gasless 流程。
