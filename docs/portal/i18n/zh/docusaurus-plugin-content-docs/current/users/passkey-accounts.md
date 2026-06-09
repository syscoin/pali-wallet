---
title: 智能账户与 passkeys
---

Pali 智能账户是由模块控制的 EVM 合约账户。Passkey 是一种受支持的控制方式；也可以使用 ECDSA 或组合策略。

它们适合 passkey 批准、团队 owner、批量操作和 guardian recovery。Pali 通过 factory 确定性部署，并保存持久元数据。Guardian recovery 不是立即生效：guardian 签署意图，模块按延迟排程，之后才能替换验证器。
