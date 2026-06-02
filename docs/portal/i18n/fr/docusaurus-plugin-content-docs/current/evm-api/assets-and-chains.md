---
title: Actifs et chaînes
---

Pali prend en charge les méthodes de portefeuille courantes pour suivre des actifs et gérer des chaînes EVM.

## Suivre un actif

```js
await window.ethereum.request({
  method: 'wallet_watchAsset',
  params: {
    type: 'ERC20',
    options: {
      address: tokenAddress,
      symbol: 'TOKEN',
      decimals: 18,
      image: 'https://example.com/token.png',
    },
  },
});
```

L'utilisateur doit approuver l'actif avant qu'il soit ajouté à Pali.

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

## Changer de chaîne

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Conseils UX

Demandez des changements de chaîne uniquement lorsque l'utilisateur commence une action qui nécessite cette chaîne. Ne forcez pas le changement pendant le chargement de la page.
