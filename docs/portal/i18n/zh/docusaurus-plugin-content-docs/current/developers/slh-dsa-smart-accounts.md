---
title: SLH-DSA 智能账户
---

Pali 智能账户支持模块化验证器。后量子验证器使用由 Pali 管理的本地 **SLH-DSA-SHA2-128s** 签名。在 API 中，认证器 id 是 `slh-dsa`。

:::caution Alpha 说明
Pali 智能账户和 SLH-DSA 仍是早期基础设施。请先在支持的测试网或小额账户中使用，保留恢复路径或备用验证器，不要让 dapp UX 依赖固定的设置或签名时间。
:::

## Dapp 请求

使用 `wallet_prepareSmartAccount` 请求智能账户：

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Post-quantum test account',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

不要包含 `keyId`、`pkSeed`、`pkRoot` 或其他 SLH-DSA 密钥材料。Pali 会生成并管理本地签名器。Dapp 提供的 SLH-DSA 密钥会被拒绝，以避免创建 Pali 无法签名的账户。

## 签名流程

Pali 使用本地 SLH-DSA 签名器对智能账户 action hash 进行签名。签名前，Pali 会检查目标账户、已加载的元数据、当前验证器 `slh-dsa`、公钥是否匹配，以及当前会话是否能解密本地状态。

如果检查失败，Pali 不会签名，并会要求重新生成本地状态或使用其他批准方式。

## 限制和 gas

- 每个密钥的绝对容量：`2^24`;
- 普通签名限制：`2^24 - 1,000`;
- 为轮换保留的签名次数：`1,000`;
- 签名长度：`3,856` 字节;
- SLH-DSA `preVerificationGas`：`130,000`;
- SLH-DSA `verificationGasLimit`：`700,000` 保守上限。

当 `signatureCount >= signatureLimit` 时，Pali 会停止使用该密钥签署普通操作，只允许为明确的 `rotateValidator` 执行使用保留预算。Dapp 不应假设固定的签名时间。

## 参考

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
