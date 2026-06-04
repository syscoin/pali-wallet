---
title: 创建和恢复 Passkey 账户
---

`wallet_createPasskeyAccount` 会为 dapp 引导流程创建新的 Passkey 智能账户。Pali 创建或选择 WebAuthn 凭证，在链上部署智能账户，确认已部署的恢复元数据，并在确认后将账户写入本地钱包状态。

本地钱包状态表示已部署的 Passkey 账户。对于已经存在于链上的账户，可以在 Pali 设置中恢复。

## 智能账户和 factory 结构

Passkey 系统有两个链上部分：

- **Factory：** 创建账户、计算 counterfactual 地址、暴露恢复查找，并可以部署加执行首次操作。
- **智能账户：** 存储恢复元数据、nonce、sponsor 策略，并在运行调用前验证 WebAuthn/P-256 执行证明。

Factory 账户参数包括：

| 参数 | 含义 |
| --- | --- |
| `passkeyX`, `passkeyY` | 从 WebAuthn 凭证中提取的 P-256 公钥坐标。 |
| `credentialIdHash` | WebAuthn credential id 的哈希。 |
| `rpIdHash` | 来自 authenticator data 的 WebAuthn RP ID hash。 |
| `originHash`, `originLength` | 来自 WebAuthn client data 的扩展 origin 绑定数据。 |
| `salt` | 部署 salt，使一个凭证可以控制多个智能账户。 |

智能账户暴露执行、签名验证、nonce、sponsor 策略和恢复元数据读取。Pali 使用这些元数据在本地状态丢失后重建账户。

## 在禁用 sponsorship 的情况下创建

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## 使用 sponsor 策略创建

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="带有 required sponsor 策略详情的 Pali Passkey 账户创建弹窗" />
</a>
  <figcaption>Required sponsorship 会在用户批准前显示 sponsor URL、signer 和策略文本。</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## 创建和部署行为

当 dapp 请求 Passkey 账户时：

1. Pali 验证活跃链支持 Passkey 智能账户。
2. Pali 为新的账户路径创建新的 deployment salt。
3. Pali 获取或创建 WebAuthn credential profile。
4. Pali 计算 counterfactual 地址和部署元数据。
5. Pali 会要求用户对部署 approval hash 进行 Passkey assertion。
6. Pali 通过配置的部署 gas payer 提交 `createAccount`；如果需要初始 sponsor policy 操作，则提交 `createAccountAndExecute`。
7. Pali 等待确认，从链上读取智能账户恢复元数据，并验证其与准备好的凭证和 origin data 匹配。
8. 确认后，Pali 创建本地 Passkey 账户并连接到请求的 dapp。

如果生成的地址已作为已部署 Passkey 账户存在于本地，Pali 可以复用该本地账户。

## 地址由什么决定？

智能账户地址由 factory 输入派生，包括 Passkey 公钥坐标、credential hash、origin data、RP ID hash、deployment salt。每条新的账户路径都会使用新的 deployment salt，因此一个凭证可以控制多个智能账户。

## 如果用户丢失本地 Pali 数据

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="用于恢复 Passkey 智能账户的 Pali 设置界面" />
</a>
  <figcaption>恢复界面会发现与已恢复钱包和 authenticator 匹配的链上 Passkey 账户。</figcaption>
</figure>

如果浏览器配置文件、扩展存储或本地 Passkey 账户元数据丢失，链上仍可能包含足够的公开元数据来恢复账户：

1. Pali 从用户的 authenticator 请求一个可发现的 WebAuthn assertion。
2. Pali 按 credential hash 查询 factory registry。
3. Pali 读取每个候选账户的恢复元数据。
4. Pali 跳过本地已存在的账户。
5. Pali 将匹配账户导回本地钱包状态。

设置中的恢复会发现已部署账户，并导入 registry 针对该凭证公开的每个匹配账户。

## RP ID 和凭证名称

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="浏览器或操作系统 Passkey assertion 提示" />
</a>
  <figcaption>恢复和执行需要来自相关 Passkey 凭证的 WebAuthn assertion。</figcaption>
</figure>

除非钱包路径提供 RP ID，否则浏览器会控制扩展 origin WebAuthn 的有效 RP ID。Pali 将默认共享凭证标记为 `Pali Wallet Passkey`，并使用请求的账户 label 来建立面向用户的账户关联。
