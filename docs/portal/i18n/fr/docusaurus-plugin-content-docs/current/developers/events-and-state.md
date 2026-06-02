---
title: Événements et état du provider
---

Écoutez les événements du provider afin que votre application reste synchronisée lorsque l'utilisateur change de compte, de réseau, d'état de verrouillage ou d'état UTXO.

## Événements EVM

```js
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('EVM accounts', accounts);
});

window.ethereum.on('chainChanged', (chainId) => {
  console.log('EVM chain', chainId);
});

window.ethereum.on('disconnect', (error) => {
  console.warn('Provider disconnected', error);
});
```

## Événements personnalisés Pali

Pali émet aussi des notifications personnalisées du portefeuille utilisées par le provider de l'extension.

| Événement | Signification |
| --- | --- |
| `pali_accountsChanged` | Le compte connecté a changé. |
| `pali_chainChanged` | La chaîne active a changé. |
| `pali_unlockStateChanged` | L'état de verrouillage du portefeuille a changé. |
| `pali_isBitcoinBased` | La famille UTXO active a changé. |
| `pali_xpubChanged` | Le xpub UTXO connecté a changé. |
| `pali_blockExplorerChanged` | L'explorer UTXO actif a changé. |

## Méthodes d'état du provider

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

L'état du provider est utile pour l'initialisation, mais ne le traitez pas comme un substitut aux vérifications explicites de permission de compte.
