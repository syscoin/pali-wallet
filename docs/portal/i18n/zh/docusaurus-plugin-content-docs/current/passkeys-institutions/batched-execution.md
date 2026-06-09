---
title: 批量执行
---

Pali 智能账户通过 `wallet_sendCalls` 支持批量执行。用户查看多个 calls，并将它们作为一次账户操作授权。当 `atomicRequired` 为 true 时，Pali 会把选中的 calls 准备为一次智能账户执行。该流程不支持 target 为空的合约部署 calls。
