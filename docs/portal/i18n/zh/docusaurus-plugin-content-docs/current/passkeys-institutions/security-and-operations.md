---
title: 安全与运营
---

Pali 智能账户应被视为账户基础设施。合约持有资产，已安装的模块决定谁能移动这些资产。

## 检查清单

- 确认哪个验证器控制账户：passkey、ECDSA、composite 或 recovery。
- 将外部 ECDSA owners 视为高风险。
- 定义 guardians、threshold 和恢复延迟。
- 确保 gas payer 有足够余额。
- 监控部署失败、模块安装失败和过期恢复。

Guardian recovery 是带延迟的验证器替换。Pali 每次尝试使用新的 salt，模块每个账户只允许一个活跃 recovery。
