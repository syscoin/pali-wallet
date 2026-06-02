---
title: Helpers de activos, SPT y NFT
---

Pali expone helpers de activos Syscoin mediante el proveedor UTXO y la API helper `_sys`.

## Obtener tokens de la billetera

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Obtener metadatos de activos Syscoin

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## Usar helpers `_sys`

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## Comprobaciones NFT

El helper `_sys.isNFT(guid)` está disponible en la capa de utilidad del proveedor inyectado. El método de solicitud `sys_isNFT` está registrado en el catálogo de métodos de la billetera, pero la cobertura de la implementación actual debe validarse antes de depender de él en producción.

## Guía de UX para activos

Muestra nombres, símbolos, cantidades y GUIDs de activos claramente antes de pedir a los usuarios que firmen transacciones de activos UTXO. Los flujos de activos UTXO están menos estandarizados que los flujos de tokens ERC, por lo que las dapps no deben asumir que la UI de la billetera puede inferir cada detalle.
