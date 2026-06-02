---
title: Asset-, SPT- und NFT-Helfer
---

Pali stellt Syscoin-Asset-Helfer über den UTXO-Provider und die `_sys`-Helfer-API bereit.

## Wallet-Token abrufen

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Syscoin-Asset-Metadaten abrufen

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## `_sys`-Helfer verwenden

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## NFT-Prüfungen

Der `_sys.isNFT(guid)`-Helfer ist in der injizierten Provider-Utility-Schicht verfügbar. Die Request-Methode `sys_isNFT` ist im Wallet-Methodenkatalog registriert, aber die aktuelle Implementierungsabdeckung sollte validiert werden, bevor man sich in Produktion darauf verlässt.

## Asset-UX-Empfehlung

Zeigen Sie Asset-Namen, Symbole, Beträge und GUIDs klar an, bevor Sie Benutzer bitten, UTXO-Asset-Transaktionen zu signieren. UTXO-Asset-Flows sind weniger standardisiert als ERC-Token-Flows, daher sollten dapps nicht annehmen, dass die Wallet-UI jedes Detail ableiten kann.
