---
title: Modes EVM et UTXO
---

Pali prend en charge les réseaux EVM basés sur des comptes et les réseaux basés sur UTXO. L'extension utilise des surfaces de provider séparées parce que les modèles de compte sont fondamentalement différents.

## Mode EVM

Le mode EVM est destiné aux dapps qui utilisent `window.ethereum`. Il prend en charge les demandes de compte de style MetaMask, les transactions, les signatures, les permissions, les demandes de suivi de jeton et la gestion de réseau.

Exemples :

- dapps Rollux et Syscoin NEVM
- interactions ERC-20, ERC-721 et ERC-1155
- signature de données typées EIP-712
- création et exécution de comptes intelligents passkey

## Mode UTXO

Le mode UTXO est destiné aux dapps qui utilisent `window.pali`. Il prend en charge l'état de compte Syscoin UTXO, les intégrations tenant compte du xpub, la signature PSBT, la diffusion de transactions et les flux d'actifs SPT.

Exemples :

- applications d'actifs Syscoin UTXO
- flux PSBT de type Bitcoin
- dapps qui ont besoin d'une adresse de rendu de monnaie
- dapps qui lisent l'historique des transactions UTXO

## Changer de mode

Si une dapp demande une méthode pour la mauvaise famille de chaînes, Pali peut exiger un changement de réseau. Les dapps doivent gérer ces erreurs proprement et guider les utilisateurs vers le bon réseau.

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

Passer d'un contexte UTXO à un contexte EVM peut exiger de reconnecter la dapp, car la famille de compte active change.
