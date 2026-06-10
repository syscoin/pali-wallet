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
