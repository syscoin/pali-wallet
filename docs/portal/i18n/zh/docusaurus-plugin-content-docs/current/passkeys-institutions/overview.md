---
title: Passkey 与机构
---

Pali Passkey 智能账户让 dapp 可以从钱包请求链上账户创建，同时用户通过 WebAuthn 控制执行。

这适用于：

- 机构引导流程
- sponsor 支持的 gas 流程
- 共同授权策略
- 钱包重装后的账户恢复
- 原子多调用工作流
- 希望获得 Passkey UX 但不想构建钱包的 dapp

## 为什么 zkSYS Passkey 可行

Passkey 使用 WebAuthn，而 WebAuthn 的标准签名算法是 ES256：基于 P-256 曲线的 ECDSA，也称为 secp256r1。通用 EVM 钱包通常使用 secp256k1 EOA，因此 Passkey 签名并不直接等同于 EOA 签名。

Pali 的 Passkey 账户是围绕链上 P-256 验证设计的 zkSYS 智能账户。钱包提取 WebAuthn 公钥坐标、challenge、authenticator data、client data 和 P-256 签名，然后智能账户/factory 路径会根据账户注册元数据验证该证明。这就是设备生物识别或平台 Passkey 能够在私钥留在用户 authenticator 内部的同时用于账户授权的原因。

实际结果是一种感觉像生物识别登录、但会授权链上操作的钱包 UX：

1. dapp 请求 Passkey 智能账户或批量执行。
2. Pali 为确切的链、账户、调用、nonce、deadline 和 sponsor 策略准备 action hash。
3. 浏览器/OS 请求用户进行 Passkey 批准。
4. zkSYS 智能账户在执行前在链上验证 P-256 WebAuthn proof。

## 支持的网络

并非每条 EVM 链都启用了 Passkey 账户。它们需要已配置的 Passkey factory 和 zkSYS P-256 验证支持。

| 网络 | Chain id | 此 Pali 构建中的状态 |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | 已配置。Factory：`0x4DB71a59725aB275fc2127da02F9DBA4946227F0`。 |
| `zkSYS` | 钱包配置中待定 | 一旦 factory 地址在 Pali 中配置完成，计划作为相同 Passkey 架构的生产目标。 |

如果 dapp 在没有已配置 factory 的网络上调用 `wallet_createPasskeyAccount`，Pali 会拒绝该请求，而不是创建不受支持的元数据。

## dapp 方法

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="sponsorship disabled 的 Pali wallet_createPasskeyAccount 弹窗" />
</a>
  <figcaption>默认的 dapp 驱动 Passkey 流程应以 sponsorship disabled 开始，除非机构明确需要 sponsor 策略。</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

结果包含智能账户 `address` 和公开 Passkey 元数据。

## Sponsor modes

| 模式 | 含义 |
| --- | --- |
| `disabled` | 无 sponsor 策略。钱包/用户支付 gas。 |
| `gasOnly` | Sponsor service 可以支付 gas。Pali 对此模式要求 sponsor URL；如果 sponsorship 失败，可以允许 wallet-gas 回退。 |
| `required` | 策略要求 sponsor 共同授权。必须提供 signer；当 Pali 可以从钱包中的本地账户获得 signer proof 时，sponsor URL 是可选的。 |

## 用户控制

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="浏览器或操作系统 Passkey 创建界面" />
</a>
  <figcaption>钱包审核后，浏览器或操作系统会处理 WebAuthn Passkey 创建。</figcaption>
</figure>

用户会在批准前看到请求站点、label、sponsor mode、signer、URL 和策略文本。然后浏览器或 OS 会显示 WebAuthn Passkey 提示。

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey dapp 引导流程"></video>
  <figcaption>Passkey 引导流程：品牌介绍、dapp 请求和 Pali 账户批准。</figcaption>
</figure>
