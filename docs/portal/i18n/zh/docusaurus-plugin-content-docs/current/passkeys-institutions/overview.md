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

- **验证器**检查日常账户批准的签名，例如通行密钥、ECDSA 和组合策略。
- **执行器**可以通过已安装模块执行账户操作。Pali 的守护者模块要求配置的门槛和等待期。钱包引导流程用于替换当前验证器，但链上模块并不限于这一界面操作。

因此，守护者拥有延迟的账户权限。如果达到门槛的守护者被攻破，控制权和资金就会面临风险。当前所有者可在等待期内采取措施，但保护操作必须先于恶意执行确认。请参阅[守护者恢复](../users/smart-account-validators)。

## 组合签名策略

组合验证器把子验证器组合在一个阈值之下，使一个账户变成一个策略引擎：

- **1-of-N**——多个认证器中的任意一个即可批准。适合在每台设备上都有 passkey 的个人账户。
- **t-of-N**——必须达到法定人数才能批准。这是共享金库、交易台和团队控制账户的自然形态。
- **N-of-N**——每个已配置的验证器都必须批准。面向最高保障的账户。

Pali 当前收集本地可用的内置子验证器批准，直到达到门槛。此版本不支持嵌套组合策略，也不收集外部或跨设备批准。守护者恢复仍独立于当前验证器策略。

## 验证器灵活性与后量子就绪

在已配置的网络上，Pali 支持钱包控制的 ECDSA、P-256 WebAuthn 通行密钥、SLH-DSA 和组合验证器。相关链上模块必须已部署，所需的本地密钥或凭据也必须可用。可替换模块还允许未来在同一账户地址采用其他签名方案。更换验证器不会迁移资金、历史记录或集成。

守护者模块验证普通地址的 ECDSA 批准和合约账户的 ERC-1271 批准。Pali 可使用本地密钥守护者，以及可为其签名的已部署本地智能账户守护者，包括 SLH-DSA。无法作为本地签名账户使用的外部守护者需要外部批准流程。

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

## 标准参考

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
