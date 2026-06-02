---
title: 用户入门
---

Pali 让你可以从一个扩展中管理 EVM 账户、Syscoin UTXO 账户和 Passkey 智能账户。

## 基本设置

1. 安装 Pali 扩展。
2. 创建新钱包或导入现有 seed phrase。
3. 设置强密码。
4. 离线备份你的 seed phrase。
5. 选择你要使用的网络。
6. 只连接你信任的 dapp。

## 连接到 dapp

当站点请求访问时，Pali 会打开连接弹窗，显示该站点并让你选择账户。dapp 只会收到已连接账户地址和已批准的 provider 状态。

Pali 按站点存储连接。你可以将不同站点连接到不同账户，但每个站点一次只有一个活跃账户。

## EVM 账户

将 EVM 账户用于 Ethereum 兼容链、Rollux、Syscoin NEVM，以及期望 MetaMask 风格钱包行为的 dapp。

EVM dapp 可以请求：

- 账户访问
- 交易
- personal 签名
- typed data 签名
- token watch 请求
- 链添加/切换请求
- 批量调用请求

## UTXO 账户

将 UTXO 账户用于 Syscoin UTXO 和 Bitcoin 风格交易流程。UTXO dapp 可以请求感知 xpub 的状态、找零地址、PSBT 签名和交易广播。

## Passkey 智能账户

Passkey 账户是由 WebAuthn 凭证控制的智能账户。它们可用于机构管理的引导流程、账户恢复和 sponsored execution。一些 Passkey 账户在首次部署交易之前是 counterfactual 的。
