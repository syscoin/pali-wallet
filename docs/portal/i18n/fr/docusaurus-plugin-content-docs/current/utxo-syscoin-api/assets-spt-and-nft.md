---
title: Assistants actifs, SPT et NFT
---

Pali expose des assistants d'actifs Syscoin via le provider UTXO et l'API d'assistance `_sys`.

## Obtenir les jetons du portefeuille

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Obtenir les métadonnées d'un actif Syscoin

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## Utiliser les assistants `_sys`

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## Vérifications NFT

L'assistant `_sys.isNFT(guid)` est disponible dans la couche utilitaire du provider injecté. La méthode de requête `sys_isNFT` est enregistrée dans le catalogue de méthodes du portefeuille, mais la couverture de l'implémentation actuelle doit être validée avant de s'y fier en production.

## Conseils UX pour les actifs

Affichez clairement les noms, symboles, montants et GUIDs des actifs avant de demander aux utilisateurs de signer des transactions d'actifs UTXO. Les flux d'actifs UTXO sont moins standardisés que les flux de jetons ERC ; les dapps ne doivent donc pas supposer que l'interface du portefeuille peut déduire chaque détail.
