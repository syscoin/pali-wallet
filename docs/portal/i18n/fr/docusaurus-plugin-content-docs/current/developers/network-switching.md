---
title: Changement de réseau
---

Pali prend en charge le changement de réseau EVM, l'ajout de chaîne EVM, le changement de chaîne UTXO et le changement de famille UTXO/EVM.

## Ajouter une chaîne EVM

```js
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [
    {
      chainId: '0x39',
      chainName: 'Syscoin NEVM',
      nativeCurrency: { name: 'Syscoin', symbol: 'SYS', decimals: 18 },
      rpcUrls: ['https://rpc.syscoin.org'],
      blockExplorerUrls: ['https://explorer.syscoin.org'],
    },
  ],
});
```

## Changer de chaîne EVM

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Passer d'une famille UTXO à EVM

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

## Conseils pour les dapps

Traitez le changement de réseau comme une approbation utilisateur. Évitez de changer de réseau au chargement de la page. Demandez seulement après que l'utilisateur a initié une action qui nécessite le réseau cible.
