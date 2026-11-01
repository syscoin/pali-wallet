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

## 私密票据

Pali 可以使用默认隐私服务或您自己的 Sysnode 服务。要运行自己的服务，请参阅 [Sysnode 指南](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md)。

默认最多保存 128 张票据（不超过 4 MiB）。在**票据容量**中可选择 256 张（不超过 8 MiB）或 512 张（不超过 16 MiB）；较高上限可能占用更多本地存储并减慢保险库操作。更改上限不会删除票据，但旧版钱包可能无法读取更新后的保险库格式。

使用**清除已完成票据**验证并删除已完成的票据。已知提款以及任何已记录的相关存款都必须最终确定；未验证的票据仍会保存。所选 Ethereum RPC 会收到提款交易哈希，以及存在时相关存款的交易哈希，因此服务商可能将两者关联。验证依赖该 RPC 的响应。
