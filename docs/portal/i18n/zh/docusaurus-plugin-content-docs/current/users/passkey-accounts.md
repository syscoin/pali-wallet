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

## 监护人恢复

Pali 在生产环境中使用自托管恢复监护人来恢复 Passkey 账户。监护人可以是备份 EVM 钱包、导入账户或硬件钱包，由用户独立于当前活跃的 Passkey 进行控制。只要 Passkey 仍然控制该账户，用户就可以在策略界面添加或移除监护人，并更新恢复等待期。

监护人恢复不是即时完成的。启动恢复时，会创建一个替换 Passkey，要求已配置的监护人签署恢复意图，并提交带有时间锁的恢复请求。等待期结束后，任何人都可以 finalize 该恢复交易。随后，用户可以使用普通的 Passkey 恢复流程，通过替换 Passkey 导入该账户。

监护人签名会绑定链、监护人恢复验证器、账户地址、替换 Passkey 身份、恢复 nonce 和过期时间。这可以防止将同一个监护人签名复用于其他账户、链或 Passkey，同时仍允许恢复启动交易被中继。

技术说明：监护人恢复验证器会为每个账户存储监护人集合、阈值、延迟和待处理恢复。为保持 UX 清晰，Pali 当前展示简单的 1-of-1 监护人流程，而合约支持 1-of-N 或 M-of-N 等阈值策略。

## Dapp 创建的账户

Dapp 可以在 `wallet_createPasskeyAccount` 期间请求监护人恢复元数据：

```json
{
  "label": "Trading desk",
  "recovery": {
    "guardian": {
      "address": "0x...",
      "delay": 86400
    }
  }
}
```

Pali 不会在账户创建时自动附加由 dapp 提供的监护人，因为钱包目前还无法认证该地址的真实性。如果 dapp 建议使用某个监护人，Pali 会警告用户并允许其创建账户；之后用户可以在 Passkey 账户策略界面添加自己信任的监护人。未来版本可能会为已知的默认监护人添加可信字典或白名单。
