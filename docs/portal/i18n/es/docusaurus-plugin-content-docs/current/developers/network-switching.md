---
title: Cambio de red
---

Pali admite cambio de red EVM, adición de cadenas EVM, cambio de cadenas UTXO y cambio de familia UTXO/EVM.

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

## Cambiar una cadena EVM

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Cambiar entre familia UTXO y EVM

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

## Guía para dapps

Trata el cambio de red como una aprobación del usuario. Evita cambiar al cargar la página. Solicítalo solo después de que el usuario inicie una acción que requiere la red objetivo.
