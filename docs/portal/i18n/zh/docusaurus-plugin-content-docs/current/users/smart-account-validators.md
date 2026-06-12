---
title: 智能账户与 passkeys
---

Pali 智能账户是由模块控制的 EVM 合约账户。Passkey 是一种受支持的控制方式；也可以使用 ECDSA 或组合策略。

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>用户可以在设置中或通过 dapp 请求创建模块化智能账户，然后选择控制批准的验证器。</figcaption>
</figure>

可以把验证器理解为"谁能批准这个账户的操作？"这个问题的答案——而有用的地方在于：答案可以改变，账户本身却不用变：

- **我的任意一种登录方式**（1-of-N）：用手边任何一个 passkey 或密钥批准。
- **我们中的几个人一起**（t-of-N）：必须有法定人数的人或设备同意，适合共享资金。
- **我们所有人一起**（N-of-N）：每个已配置的登录方式都必须批准，用于最敏感的账户。

策略甚至可以包含其他策略，因此团队可以表达"负责人的密钥加上任意两个交易台 passkeys"这样的规则。策略变更时，你的地址、余额和历史完全保持不变——而且由于签名是模块化的，未来的签名类型（包括后量子方案）以后也可以在同一账户上采用。

Guardians 刻意**不**在这个列表里。guardian 永远无法批准交易；他唯一的权力是在你失去访问权时发起一次缓慢、可见的恢复。这种分离既保护你不会失去访问权，又不把日常控制权交给任何人。

它们适合 passkey 批准、团队 owner、批量操作和 guardian recovery。Pali 通过 factory 确定性部署，并保存持久元数据。Guardian recovery 不是立即生效：guardian 签署意图，模块按延迟排程，之后才能替换验证器。

在链上，guardian 并不限于普通密钥：guardian 的批准通过 ECDSA 或 ERC-1271 验证，所以 guardian 也可以是已部署的合约账户——包括另一个以组合、自定义或后量子验证器作为自身策略的智能账户。此时恢复路径会继承该 guardian 的签名方案。Pali 当前的 guardian 界面收集基于密钥的批准；由于已部署的模块本身已经支持，合约账户 guardian 的流程以后可以再添加。

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>智能账户策略界面显示已安装的模块、当前验证器详情、guardian recovery 和模块管理。</figcaption>
</figure>
