---
title: 创建和恢复智能账户
---

`wallet_prepareSmartAccount` 为 dapp 引导流程创建 Pali 智能账户。Pali 会派生账户，通过配置的工厂合约部署，在需要时安装请求的验证器，将账户连接到请求它的 dapp，并把持久账户元数据写入本地钱包状态。

本地钱包状态记录 Pali 能够操作的智能账户。智能账户可以由通行密钥验证器、ECDSA 验证器、组合验证器或创建后安装的守护者恢复模块控制。

## 智能账户与工厂结构

智能账户系统由以下部分组成：

- **工厂合约：**计算确定性地址，并使用初始模块数据部署账户。
- **智能账户：**执行调用、跟踪已安装的模块，并请求验证器模块批准签名。
- **验证器：**授权操作。Pali 支持 ECDSA、P-256 WebAuthn 通行密钥和组合验证器。
- **执行器：**扩展账户功能。Pali 将守护者恢复用作执行器模块。

工厂账户参数包括：

| 参数 | 含义 |
| --- | --- |
| `salt` | Pali 根据钱包锚点、账户索引、链和账户版本派生的确定性部署盐值。 |
| `initialValidator` | 引导部署所用的验证器模块。Pali 使用钱包控制的 ECDSA 验证器来进行确定性设置。 |
| `initData` | 编码后的验证器初始化数据。 |

部署完成后，Pali 可以在一次智能账户批处理中安装请求的验证器，并移除引导验证器。因此，dapp 可以请求由通行密钥控制的账户，同时 Pali 仍能保持首次部署路径的确定性。

## 创建由通行密钥控制的账户

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

如果 dapp 省略 `authenticator`，Pali 默认使用通行密钥流程。请使用仅包含 id 的请求，例如 `{ id: 'p256-webauthn' }`，由 Pali 选择或创建钱包控制的凭据。外部 ECDSA 所有者仍使用下述明确确认流程。

## 创建 ECDSA 智能账户

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Team account',
      authenticator: {
        id: 'ecdsa',
        config: {
          owners: ['0xOwnerAddress'],
          threshold: 1,
        },
      },
    },
  ],
});
```

已经是本地 Pali 钱包账户的 ECDSA 所有者会被视为钱包控制的所有者。外部 ECDSA 所有者地址能够批准智能账户的后续操作，因此只有在显示明确警告并得到确认后才允许使用。

## 创建与部署行为

当 dapp 请求智能账户时：

1. Pali 确认当前链已配置 Pali 智能账户基础设施。
2. Pali 派生下一个确定性的账户描述符和反事实地址。
3. Pali 创建或规范化请求的认证器。
4. Pali 显示 dapp 主机名、账户标签、认证器类型和所有外部 ECDSA 所有者。
5. Pali 在本地创建账户，并使用引导验证器将其部署到链上。
6. 如果请求的验证器与引导验证器不同，Pali 会通过一次智能账户执行安装请求的验证器并卸载引导验证器。
7. Pali 等待确认、保存持久智能账户元数据，并将账户连接到 dapp。

如果生成的地址已存在于本地，Pali 可以复用该本地智能账户。

## 地址由什么决定？

智能账户地址由工厂合约、账户实现、引导验证器初始化数据以及 Pali 的确定性部署盐值共同派生。Pali 根据钱包锚点和账户索引派生盐值，因此可以通过钱包元数据恢复账户，而不依赖随机的本地状态。

## 用户丢失本地 Pali 数据时

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali 中用于恢复智能账户的设置页面" />
</a>
  <figcaption>恢复页面可以重建 Pali 创建的账户，或通过守护者恢复替换活动验证器，从而帮助恢复智能账户访问权。</figcaption>
</figure>

如果浏览器配置文件、扩展存储或本地智能账户元数据丢失，恢复方式取决于账户当前的模块：

- Pali 创建的确定性账户可以根据钱包锚点、链、账户索引和工厂配置重建。
- 通行密钥验证器仍需要相应的 WebAuthn 凭据，才能授权后续操作。
- 如果原批准方式不可用，守护者恢复可以在配置的延迟结束后替换活动验证器。

Pali 恢复流程是自托管的。它不是服务器后门，也无法绕过账户已安装的模块。

## RP ID 与凭据名称

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="浏览器或操作系统中的通行密钥断言提示" />
</a>
  <figcaption>恢复和执行操作都需要由相应通行密钥凭据提供 WebAuthn 断言。</figcaption>
</figure>

对于扩展来源的 WebAuthn，除非钱包流程提供 RP ID，否则实际 RP ID 由浏览器决定。Pali 将默认共享凭据标记为 `Pali Wallet Passkey`，并使用请求的账户标签来向用户展示账户关联。
