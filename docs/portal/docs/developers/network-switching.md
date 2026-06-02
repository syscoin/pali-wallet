---
title: Network switching
---

Pali supports EVM network switching, EVM chain addition, UTXO chain switching, and UTXO/EVM family switching.

## Add an EVM chain

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

## Switch an EVM chain

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Switch between UTXO and EVM family

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

## Dapp guidance

Treat network switching as a user approval. Avoid switching on page load. Ask only after the user initiates an action that requires the target network.
