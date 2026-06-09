---
title: 创建和恢复智能账户
---

`wallet_prepareSmartAccount` 用于 dapp onboarding 创建 Pali 智能账户。Pali 会派生账户，通过已配置的 factory 部署账户，在需要时安装请求的验证器，将账户连接到 dapp，并在本地保存持久元数据。

## 结构

- **Factory:** 计算确定性地址并部署账户。
- **智能账户:** 执行 calls，并询问已安装的验证器。
- **验证器:** ECDSA、P-256 WebAuthn passkey 和 composite。
- **执行器:** guardian recovery，用于带延迟的恢复。

## 恢复

恢复取决于已安装的模块。确定性账户可以通过 wallet anchor、chain、index 和 factory 重建。Passkey 验证器需要对应的 WebAuthn 凭证。Guardian recovery 可以在配置的延迟后替换当前验证器。
