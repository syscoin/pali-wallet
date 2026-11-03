---
title: 术语表
---

## 账户家族

网络使用的钱包账户模型。EVM 账户是基于账户的。Syscoin UTXO 和 Bitcoin 风格账户是基于 UTXO 的。

## EIP-1193

Ethereum 钱包通过 `provider.request()` 使用的标准 JavaScript provider 接口。

## EIP-6963

一种多钱包发现标准，让 dapp 不必只依赖 `window.ethereum` 即可发现 provider。

## Passkey 智能账户

由 WebAuthn 凭证控制的 EVM 智能账户，而不是由普通 EOA 私钥控制。

## PSBT

Partially Signed Bitcoin Transaction。用于协调 UTXO 交易签名的常见格式。

## Sponsor service

由机构运营的服务，可以为 Passkey 智能账户执行提供 gas sponsorship、relay support 或 required co-authorization。

## SPT

Syscoin Platform Token，Syscoin UTXO 侧的资产。

## UTXO

Unspent Transaction Output。Bitcoin 类链和 Syscoin UTXO 使用的账户模型。

## WebAuthn

Passkey 背后的浏览器标准。它允许用户通过平台 authenticator、硬件密钥或同步 Passkey provider 批准加密操作。

## SLH-DSA

本地签名器使用 **SLH-DSA-SHA2-128-24**，这是 [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd) 初始草案中提出的实验性有限签名配置，并非 FIPS 205 批准的通用参数集。 在已配置的网络上，Pali 支持 ECDSA、P-256 WebAuthn 通行密钥、SLH-DSA 和组合验证器；兼容模块必须已部署，所需本地密钥或凭据也必须可用。
