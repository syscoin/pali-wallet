---
title: Активы, SPT и NFT helpers
---

Pali предоставляет Syscoin asset helpers через UTXO provider и `_sys` helper API.

## Получить токены кошелька

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Получить Syscoin asset metadata

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## Использовать `_sys` helpers

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## Проверки NFT

Helper `_sys.isNFT(guid)` доступен в injected provider utility layer. Request method `sys_isNFT` зарегистрирован в wallet method catalog, но текущее покрытие реализации следует проверить перед использованием в production.

## Рекомендации UX для активов

Показывайте asset names, symbols, amounts и GUIDs ясно перед тем, как просить пользователей подписать UTXO asset transactions. UTXO asset flows менее стандартизированы, чем ERC token flows, поэтому dapps не должны предполагать, что UI кошелька сможет вывести каждую деталь.
