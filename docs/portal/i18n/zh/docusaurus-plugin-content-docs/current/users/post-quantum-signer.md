---
title: 智能账户的后量子签名器
---

Pali 智能账户可以使用不同的验证器。其中一个验证器是本地后量子签名器，基于 **SLH-DSA-SHA2-128s**，这是 NIST 在 FIPS 205 中标准化的哈希签名方案。

简单来说：智能账户可以用一种旨在抵抗已知量子攻击的签名方式来批准操作，而不是只依赖今天常见的 ECDSA 签名。

:::caution Alpha 说明
Pali 智能账户和 SLH-DSA 验证器仍是早期基础设施。请先在支持的测试网或小额账户中使用，保留恢复路径或备用验证器，并预期设置和签名会比普通钱包签名更慢。
:::

## 有什么变化

普通 EVM 账户由一个 ECDSA 私钥控制地址。智能账户是合约账户，由验证器决定什么算作批准。验证器可以是 ECDSA、passkey、组合策略或 SLH-DSA。

保持不变：

- 智能账户地址不变。
- Dapp 仍然看到一个 EVM 地址。
- Pali 仍会在签名前显示请求供用户检查。
- Guardian 恢复和验证器轮换仍然可用。

变化：

- 设置更慢，因为 Pali 需要准备本地缓存。
- 签名可能比 ECDSA 或 passkey 更慢。
- 本地签名器状态必须保留在设备上，否则需要重新生成。

## 如何启用

1. 打开 Pali，并切换到支持的 EVM 网络。
2. 打开 **Settings**。
3. 进入智能账户或策略页面。
4. 选择 **Post-quantum / SLH-DSA**。
5. 在本地缓存准备期间保持 Pali 打开。
6. 检查并提交验证器切换交易。

如果 Pali 提示本地签名器缺失或与当前验证器不匹配，请在策略页面重新生成本地签名器状态。

## 签名限制

当前 SLH-DSA 配置的绝对容量是每个已准备的本地签名器最多 `2^24` 次签名。Pali 会保留 `1,000` 次签名用于从该密钥轮换出去的重试，因此普通签名会在 `2^24 - 1,000` 停止。这仍超过 1600 万次，普通用户通常不会接近这个限制。

如果普通签名预算用完，Pali 会停止用该密钥签署普通操作，并保留轮换重试预算。Pali 不会在签名器耗尽后继续静默签名。

## 参考

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [NIST 后量子密码项目](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
