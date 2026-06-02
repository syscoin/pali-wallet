---
title: Asset, SPT, NFT helper
---

Pali는 UTXO provider와 `_sys` helper API를 통해 Syscoin asset helper를 노출합니다.

## Wallet token 가져오기

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Syscoin asset metadata 가져오기

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## `_sys` helper 사용

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## NFT check

`_sys.isNFT(guid)` helper는 injected provider utility layer에서 사용할 수 있습니다. request method `sys_isNFT`는 wallet method catalog에 등록되어 있지만, production에서 의존하기 전에 현재 implementation coverage를 검증해야 합니다.

## Asset UX guidance

사용자에게 UTXO asset transaction 서명을 요청하기 전에 asset name, symbol, amount, GUID를 명확히 보여주세요. UTXO asset flow는 ERC token flow보다 표준화가 덜 되어 있으므로, dapp은 wallet UI가 모든 detail을 추론할 수 있다고 가정해서는 안 됩니다.
