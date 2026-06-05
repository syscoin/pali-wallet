---
title: Sponsor 服务
---

Sponsor service 是由机构控制的 endpoint，参与 Passkey 智能账户执行策略。

## Sponsor 对象


```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## 字段含义

| 字段 | 用途 |
| --- | --- |
| `mode` | `disabled`、`gasOnly` 或 `required`。 |
| `url` | Pali 为 sponsor execution support 联系的可选服务 endpoint。Pali 对 `gasOnly` sponsorship 要求该字段，因为没有 service URL 就没有远程 gas sponsor。 |
| `signer` | required policy proof 的预期 sponsor signer 地址。`required` mode 必须提供。 |
| `policyText` | 存储在钱包元数据中的面向用户说明。不是链上执行。 |

## 链上策略

智能账户策略存储 mode、signer 和公开 sponsor URL。策略文本是用于显示的钱包元数据。

## 幂等性

Sponsor execution 请求使用从 Passkey action hash 派生的 idempotency key。Sponsor service 应将具有相同 key 的重复请求视为同一操作。

## Required sponsor mode

在 `required` mode 中，sponsor proof 必须 recover 到已配置的 signer。Sponsor URL 是可选的：配置 URL 时，Pali 可以从 sponsor service 获取 proof；当已配置的 signer 是钱包中可用的账户时，Pali 可以本地签名。如果 Pali 无法获得或验证 sponsor proof，执行会失败。

Gas payment 与 sponsor authorization 分离。获得有效 sponsor proof 后，Pali 仍可从为 passkey execution 选择的任何有资金的软件账户支付 gas。

## Gas-only mode

在 `gasOnly` mode 中，sponsor service 可以 relay 或帮助支付 gas。Pali 对此模式要求 sponsor URL，因为该 URL 用于识别 gas sponsorship service。如果 sponsorship 不可用，在策略允许时 Pali 可以回退到 wallet-gas execution。

## 机构指南

- 使用稳定的每用户 sponsor URL。
- 将 signer key 保存在机构基础设施中，而不是 dapp frontend 中。
- 让策略文本简短、具体、易懂。
- 对重复 idempotency key 返回一致状态。
- 监控失败的 sponsor 请求和过期执行 deadline。
