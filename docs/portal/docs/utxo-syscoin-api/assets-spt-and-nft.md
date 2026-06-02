---
title: Assets, SPT, and NFT helpers
---

Pali exposes Syscoin asset helpers through the UTXO provider and `_sys` helper API.

## Get wallet tokens

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Get Syscoin asset metadata

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## Use `_sys` helpers

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## NFT checks

The `_sys.isNFT(guid)` helper is available in the injected provider utility layer. The request method `sys_isNFT` is registered in the wallet method catalog, but current implementation coverage should be validated before relying on it in production.

## Asset UX guidance

Show asset names, symbols, amounts, and GUIDs clearly before asking users to sign UTXO asset transactions. UTXO asset flows are less standardized than ERC token flows, so dapps should not assume wallet UI can infer every detail.
