---
title: 资产、SPT 和 NFT 辅助功能
---

Pali 通过 UTXO provider 和 `_sys` helper API 暴露 Syscoin 资产辅助功能。

## 获取钱包 token

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## 获取 Syscoin 资产元数据

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## 使用 `_sys` helper

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## NFT 检查

注入 provider utility 层中提供 `_sys.isNFT(guid)` helper。钱包方法目录中注册了请求方法 `sys_isNFT`，但在生产环境依赖它之前，应验证当前实现覆盖范围。

## 资产 UX 指南

在请求用户签名 UTXO 资产交易之前，请清楚显示资产名称、符号、数量和 GUID。UTXO 资产流程不像 ERC token 流程那样标准化，因此 dapp 不应假设钱包 UI 可以推断每个细节。
