---
title: 隐私与安全
---

Pali 的设计目标是尽量减少 dapp 在没有明确用户操作时可以获知的信息。

## Pali 不会暴露什么

Pali 不会向网页暴露 seed phrase、私钥、Passkey 私有材料、钱包密码或不受限制的账户列表。

## dapp 可以请求什么

dapp 可以请求公开账户地址、provider 状态、网络状态、签名、交易批准、PSBT 签名、资产 watch 批准、链切换、Passkey 账户创建和批量执行。

## 连接安全

只连接你信任的 dapp。已连接的 dapp 可以看到你为该 origin 批准的账户，并可以请求后续操作。你可以从钱包中撤销站点访问权限。

## 公开区块链数据

区块链活动是公开的。你的地址、交易历史、token 授权、UTXO 活动、智能账户部署以及 Passkey 智能账户活动可能会在 explorer 和 indexer 上可见。

## 机构 Passkey 隐私

如果 dapp 或机构提供 sponsor URL，该服务可能会收到与账户执行相关的 sponsor 请求。批准前请查看机构策略文本和 URL。
