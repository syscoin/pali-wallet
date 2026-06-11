---
title: 方法矩阵
---

此参考总结了从 Pali 当前方法 registry 和 provider 文档化的面向公开 dapp 的方法。

## 钱包方法

| 方法 | 表面 | 用途 | 弹窗 |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | 读取锁定状态。 | 否 |
| `wallet_isConnected` | EVM / UTXO | 读取站点连接状态。 | 否 |
| `wallet_getAccount` | EVM / UTXO | 读取已连接账户对象。 | 否 |
| `wallet_getAddress` | EVM / UTXO | 读取已连接地址。 | 否 |
| `wallet_getPublicKey` | EVM / UTXO | 读取公钥。 | 否 |
| `wallet_getBalance` | EVM / UTXO | 读取余额。 | 否 |
| `wallet_getChangeAddress` | UTXO | 读取找零地址。 | 否 |
| `wallet_getNetwork` | EVM / UTXO | 读取活跃网络。 | 否 |
| `wallet_getTokens` | EVM / UTXO | 读取 token 持仓。 | 否 |
| `wallet_estimateFee` | EVM / UTXO | 估算费用。 | 否 |
| `wallet_getProviderState` | EVM | 初始化 EVM provider 状态。 | 否 |
| `wallet_getSysProviderState` | UTXO | 初始化 UTXO provider 状态。 | 否 |
| `wallet_getSysAssetMetadata` | UTXO | 读取 Syscoin 资产元数据。 | 否 |
| `wallet_changeAccount` | EVM / UTXO | 更改已连接账户。 | 是 |
| `wallet_requestPermissions` | EVM | 请求 EIP-2255 权限。 | 是 |
| `wallet_getPermissions` | EVM | 读取 EIP-2255 权限。 | 否 |
| `wallet_revokePermissions` | EVM | 撤销权限并断开连接。 | 否 |
| `wallet_watchAsset` | EVM | 请求资产 watch。 | 是 |
| `wallet_addEthereumChain` | EVM | 添加 EVM 链。 | 是 |
| `wallet_switchEthereumChain` | EVM | 切换 EVM 链。 | 是 |
| `wallet_prepareSmartAccount` | EVM | 创建并部署 Passkey 智能账户。 | 是 |
| `wallet_sendCalls` | EVM | 发送 EIP-5792 批量请求。 | 是 |
| `wallet_getCapabilities` | EVM | 读取账户能力。 | 否 |
| `wallet_getCallsStatus` | EVM | 将已发送的 batch 解析为 EIP-5792 状态 + receipts。 | 否 |
| `wallet_showCallsStatus` | EVM | 在钱包弹窗中显示批量状态。 | 是 |

## EVM 方法

| 方法组 | 方法 |
| --- | --- |
| 账户 | `eth_requestAccounts`, `eth_accounts` |
| 交易 | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| 签名 | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| 网络 | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| 链数据 | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, block 和 transaction 查询方法 |
| 节点数据 | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## UTXO 和 Syscoin 方法

| 方法 | 用途 |
| --- | --- |
| `sys_requestAccounts` | 连接 UTXO 账户。 |
| `sys_getAccount` | 读取账户详情。 |
| `sys_isConnected` | 读取连接状态。 |
| `sys_getNetwork` | 读取 UTXO 网络。 |
| `sys_getPublicKey` | 读取公钥。 |
| `sys_getCurrentAddressPubkey` | 读取当前地址 pubkey。 |
| `sys_getBip32Path` | 读取 derivation path。 |
| `sys_getChangeAddress` | 读取找零地址。 |
| `sys_getTransactions` | 读取交易。 |
| `sys_transaction` | 读取一笔交易。 |
| `sys_sign` | 签名 PSBT。 |
| `sys_signAndSend` | 签名并广播。 |
| `sys_isValidSYSAddress` | 验证 Syscoin 地址。 |
| `sys_changeUTXOEVM` | 切换链家族。 |
| `sys_switchChain` | 切换 UTXO 链。 |

## `_sys` 辅助方法

| 辅助方法 | 用途 |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | 读取用户 mint 的 Syscoin token。 |
| `window.pali._sys.getHoldingsData()` | 读取 token 持仓。 |
| `window.pali._sys.getConnectedAccountXpub()` | 读取已连接 xpub。 |
| `window.pali._sys.getChangeAddress()` | 读取找零地址。 |
| `window.pali._sys.getDataAsset(assetGuid)` | 读取 Syscoin data asset。 |
