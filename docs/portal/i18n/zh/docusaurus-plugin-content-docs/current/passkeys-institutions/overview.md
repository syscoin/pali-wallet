---
title: Pali 智能账户
---

Pali 智能账户是由合约实现的账户，Pali 可以为用户创建、连接并操作它。对普通用户来说，它像一个普通钱包账户：查看 dapp 请求，用 passkey 或钱包密钥批准，然后由 Pali 发送交易。底层是模块化设计：验证器模块负责授权，执行器模块提供恢复等功能。

## 简单理解

- 一个账户地址持有资产，也是 dapp 看到的地址。
- 账户可以使用 passkey、ECDSA 或组合策略授权。
- Guardian recovery 可以在延迟后替换当前验证器。
- `wallet_sendCalls` 可以把多个 call 作为一次原子操作执行。

## 技术模型

`PaliSmartAccount` 执行 calls，并通过 ERC-7579 风格的模块验证签名。`PaliSmartAccountFactory` 派生确定性地址并部署账户。Pali 内部使用 ERC-4337 风格编码准备执行，并使用 EIP-1271 做合约签名验证。

## 两种角色：验证器签名，guardians 恢复

ERC-7579 区分了模块角色，Pali 刻意充分利用这种分离：

- **验证器**是签名权限。验证器决定某个批准（passkey 证明、ECDSA 签名、组合策略结果）是否授权一次账户操作。只有验证器才能批准交易。
- **执行器**添加非签名类的账户行为。Pali 的 guardian recovery 模块就是一个执行器：guardians 不能签名或转移资金，只能排程一次带时间锁的活跃验证器替换。

正是这种角色分离让恢复机制可以放心推荐。guardian 被攻破并不会给攻击者签名权限——只会给他们一次延迟的、可见的、可取消的恢复尝试。

## 组合签名策略

组合验证器把子验证器组合在一个阈值之下，使一个账户变成一个策略引擎：

- **1-of-N**——多个认证器中的任意一个即可批准。适合在每台设备上都有 passkey 的个人账户。
- **t-of-N**——必须达到法定人数才能批准。这是共享金库、交易台和团队控制账户的自然形态。
- **N-of-N**——每个已配置的验证器都必须批准。面向最高保障的账户。

组合可以嵌套：组合的子项本身也可以是组合，因此分层策略——例如"CFO 密钥 且（3 个交易台 passkeys 中任意 2 个）"——无需自定义合约即可表达。无论当前激活哪种验证器策略，guardian recovery 都保持独立。

## 验证器灵活性与后量子就绪

由于授权位于可替换的模块中，账户不会被绑定到任何签名方案。今天 Pali 提供 ECDSA（钱包持有的默认方案）、P-256 WebAuthn passkeys 和组合验证器。当新的验证器类型部署后——包括后量子签名方案——它们会安装到同一账户、同一地址上。届时逐笔交易的授权可以完全不涉及 ECDSA。资金、历史和集成永远不需要迁移；演进的只有签名权限。

同样的灵活性也延伸到了恢复。guardian recovery 模块使用标准签名校验来验证批准——普通地址用普通 ECDSA，合约账户用 ERC-1271——因此 guardian 本身也可以是一个由组合、自定义或后量子验证器治理的智能账户。使用已部署的合约账户 guardian 时，恢复路径会继承该账户的签名方案；正因如此，签名**和**恢复最终都可以在不依赖经典 ECDSA 的情况下运行。Pali 当前的 guardian 体验收集的是基于密钥的批准；由于链上模块已经支持，合约账户 guardian 的流程以后可以再加入钱包。

## 面向机构和团队

机构应把 Pali 智能账户当作账户基础设施，而不仅是 passkey 登录。passkey 适合低摩擦 onboarding；ECDSA 或组合验证器适合团队、硬件钱包或受控 owner 集；guardian recovery 适合作为延迟替换路径；同时需要准备有余额的 gas payer 来部署和执行。应清楚记录谁控制验证器、谁是 guardian、恢复延迟对用户意味着什么。

如果 dapp 请求外部 ECDSA owner，Pali 会单独警告，因为该地址可以批准未来的账户操作。

## Dapp 方法

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

## 支持的网络

Pali 智能账户可在 Pali 期望地址上已经存在 Pali factory 和模块的兼容 EVM 链上使用。这并不限于 Pali 运营的链：如果当前链提供 canonical CREATE2 deployer，Pali 可以直接在钱包内部署缺失的智能账户设置。打开 Pali Settings，进入 Advanced，并在 **Smart account setup** 中使用 Deploy 按钮。

Passkey 验证器需要 P-256 WebAuthn 验证支持。许多现代 EVM 环境通过 P-256/passkey precompile 提供该能力，但集成方在依赖 passkey 验证器前仍应确认链上支持。

## 用户控制

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>钱包审查后，如果所选验证器基于 passkey，浏览器或操作系统会处理 WebAuthn passkey 的创建。</figcaption>
</figure>

用户在批准前可以看到请求的站点、账户标签、请求的认证器以及任何外部 ECDSA owner 地址。当 Pali 需要新的 passkey 凭证时，浏览器或操作系统会显示 WebAuthn 提示。在智能账户连接到 dapp 之前，Pali 会显示部署、模块安装和确认进度。

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-dapp-onboarding-video.png" src="/video/smart-account-dapp-onboarding.mp4" title="Smart-account dapp onboarding flow"></video>
  <figcaption>由 dapp 发起的引导：查看请求并确认，智能账户即刻可用。</figcaption>
</figure>
