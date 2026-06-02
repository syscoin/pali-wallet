---
title: Événements
---

Abonnez-vous aux événements après avoir sélectionné le provider.

## Événements EIP-1193

| Événement | Provider | Signification |
| --- | --- | --- |
| `connect` | `window.ethereum` | Provider connecté. |
| `disconnect` | `window.ethereum` | Provider déconnecté. |
| `accountsChanged` | `window.ethereum` | La liste de comptes EVM a changé. |
| `chainChanged` | `window.ethereum` | La chaîne EVM a changé. |
| `message` | `window.ethereum` | Message du provider. |

## Notifications du portefeuille Pali

| Événement | Signification |
| --- | --- |
| `pali_accountsChanged` | Le compte connecté a changé. |
| `pali_chainChanged` | La chaîne active a changé. |
| `pali_unlockStateChanged` | L'état de verrouillage du portefeuille a changé. |
| `pali_isBitcoinBased` | L'état de la famille UTXO active a changé. |
| `pali_xpubChanged` | Le xpub UTXO connecté a changé. |
| `pali_blockExplorerChanged` | L'explorer de blocs actif a changé. |
| `walletUpdate` | Notification de mise à jour de l'état du portefeuille. |

## Exemple

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

Supprimez les listeners lorsque votre composant est démonté afin d'éviter les mises à jour d'état dupliquées.
