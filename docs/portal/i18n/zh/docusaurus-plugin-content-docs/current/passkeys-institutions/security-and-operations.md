---
title: 安全与运营
---

机构 Passkey 集成应像生产账户基础设施一样设计，而不仅仅是一个登录按钮。

## 网络和 verifier 依赖

Passkey 账户依赖 zkSYS 对 P-256 WebAuthn 签名验证的支持。不要仅仅因为某条 EVM 链支持智能合约，就假设可以在其上创建 Passkey 账户。该链必须部署 Passkey factory，并且 Pali 必须为活跃链配置该 factory 地址。

目前，Pali 已配置的测试部署是 `zkTanenbaum`（`57057`）。一旦其 factory 在钱包中配置完成，就将 zkSYS 生产环境视为相同架构的生产部署目标。

## 运营清单

- 决定每个用户接收共享的 Pali Passkey 账户还是独立凭证。
- 决定 sponsorship 是 disabled、gas-only 还是 required。
- 如果使用 `required` mode，维护 sponsor service 可用性。
- 监控 relayer 失败、过期 deadline 和重复 idempotency key。
- 为设备丢失和恢复失败提供用户支持路径。
- 说明机构是否可以共同授权执行。

## 资金和部署

Passkey 智能账户在首次使用前可以是 counterfactual 的。首次执行可能需要部署 gas payer 或 sponsor 路径。你的引导流程应解释用户在使用前是否需要为账户充值。

Factory 可以在部署前计算账户地址。这对引导流程很有用，因为 dapp 或机构可以在首次链上交易前显示或资助该地址。

## 恢复假设

恢复受钱包范围和 Passkey 范围限制。用户通常需要：

- 已恢复的 Pali 钱包上下文
- 相关 WebAuthn 凭证
- 链支持 Passkey factory

恢复不是托管后门。链提供可发现的公开元数据和账户列表，但用户仍需要钱包恢复上下文和相关 WebAuthn 凭证来证明控制权。

## 凭证备份状态

当浏览器和 authenticator 暴露 WebAuthn 凭证备份状态时，Pali 可能会展示该状态。请将其视为运营信号，而不是链上安全规则。

备份状态可以表明凭证看起来是绑定设备、可备份，还是当前由平台 Passkey provider 备份/同步。同步的 Passkey 可以提升便利性和设备丢失后的恢复能力，因为用户可以通过其 Apple、Google、Microsoft 或其他平台账户恢复凭证。权衡是，有效安全边界现在包括该平台账户、其恢复流程，以及同步了 Passkey 的任何设备。

| 凭证状态 | 机构策略含义 | 用户体验 | 风险边界 |
| --- | --- | --- | --- |
| 已备份或已同步 | 当账户恢复和引导便利性比严格设备隔离更重要时可接受。 | 最佳设备更换和多设备体验。通常是消费者 Passkey 的平台默认值。 | 信任扩展到平台账户、平台恢复流程和同步设备。 |
| 可备份 | 决定仅有可备份资格是否可接受，因为凭证之后可能会变成同步状态。 | 灵活，但用户可能不了解同步是否处于活跃状态。 | 如果账户价值发生变化，需要清晰的用户指引和定期状态复核。 |
| 绑定设备或未备份 | 对高价值、treasury、admin 或冷存储风格账户优先采用。 | 如果设备丢失，摩擦更大，支持负担更重。 | 对特定 authenticator 或硬件密钥的隔离更强。 |
| 未知或不可用 | 除非你有带外 authenticator 控制，否则避免用于高保证策略决策。 | 用户可能继续操作，但机构无法可靠分类该凭证。 | 模糊；不要将其视为云备份证明或绑定设备隔离证明。 |

对于更高保证的机构账户，请决定并记录是否接受同步 Passkey。同步 Passkey 对常见钱包和 dapp 使用仍然安全，因为 Pali 和 dapp 永远不会收到 Passkey 私钥，WebAuthn 仍然绑定 origin，平台 authenticator 仍执行用户验证。它们只是不适合作为冷存储、treasury 控制或大额长期余额的默认选择，除非机构明确接受平台账户恢复边界。

## 用户沟通

使用清晰的策略文本。好的策略应解释：

- 谁运营 sponsor service
- 哪些操作需要共同授权
- 机构是否支付 gas
- 如果 sponsor service 不可用会发生什么

## 不要依赖策略文本进行执行

`policyText` 是披露和钱包元数据字段。执行通过链上策略和 sponsor proof 验证完成。
