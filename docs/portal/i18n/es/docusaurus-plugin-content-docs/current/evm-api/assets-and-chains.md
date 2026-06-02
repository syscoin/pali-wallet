---
title: Activos y cadenas
---

Pali admite métodos comunes de billetera para observar activos y gestionar cadenas EVM.

## Observar un activo

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

El usuario debe aprobar el activo antes de que se agregue a Pali.

## Agregar una cadena EVM

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

## Cambiar cadena

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Guía de UX

Solicita cambios de cadena solo cuando el usuario inicia una acción que necesita esa cadena. No fuerces el cambio durante la carga de la página.
