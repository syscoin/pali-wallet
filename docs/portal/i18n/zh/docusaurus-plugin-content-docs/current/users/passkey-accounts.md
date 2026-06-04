---
title: Passkey 账户
---

Passkey 账户是由 WebAuthn 凭证控制的 EVM 智能账户。用户不是用普通 EOA 私钥签名，而是通过浏览器和操作系统提供的设备或账户 Passkey UI 来批准操作。

在幕后，WebAuthn Passkey 使用 P-256 签名。zkSYS Passkey 账户的构建方式允许智能账户/factory 系统验证这些 P-256 证明，这就是为什么生物识别或平台 Passkey 批准能够授权链上操作。

## 为什么使用 Passkey 账户？

- 更容易的机构引导流程。
- 智能账户策略支持。
- 可选的 gas 或共同授权 sponsor 服务。
- 一次用户批准即可完成批量执行。
- 本地钱包元数据缺失时，可从链上 registry 数据恢复。

## 共享和独立 Passkey

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="用于创建 Passkey 账户的 Pali 设置界面" />
</a>
  <figcaption>用户既可以从设置中创建 Passkey 账户，也可以通过 dapp 请求创建。</figcaption>
</figure>

Pali 可以使用共享的钱包 Passkey profile，也可以为账户创建独立的 Passkey 凭证。共享 Passkey 对希望使用一个由钱包控制的 Passkey 的用户很方便。独立 Passkey 可以帮助机构按服务或策略隔离凭证。

## 部署

Passkey 智能账户在链上部署之前，可能以 counterfactual 地址存在。如果网络和资金路径支持，首次执行可以在同一流程中部署账户并执行请求的操作。

如果账户尚未部署，请确保 Passkey 账户或部署 gas payer 有足够的原生 token，或使用支持部署流程的机构 sponsor 路径。

## 网络支持

Passkey 账户需要 zkSYS Passkey 智能账户合约和 P-256 验证支持。在此 Pali 构建中，`zkTanenbaum` 测试网已配置用于 Passkey 账户创建。一旦生产 factory 地址在钱包中配置完成，zkSYS 生产支持会使用相同模型。

## 恢复

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Pali Passkey 账户策略设置界面" />
</a>
  <figcaption>在可用时，Passkey 策略界面会显示 sponsor mode、signer、URL 和备份状态。</figcaption>
</figure>

如果本地钱包状态被删除，或在新设备上安装 Pali，Pali 可以从链上 factory registry 和事件日志中恢复 Passkey 智能账户。任何能够访问同一 Passkey 凭证的 Pali 安装，都可以在完成 WebAuthn assertion 后发现匹配的已部署账户，跳过本地已存在的账户，并导入所选账户。
