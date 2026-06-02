---
title: Assets and chains
---

Pali supports common wallet methods for watching assets and managing EVM chains.

## Watch an asset

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

The user must approve the asset before it is added to Pali.

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

## Switch chain

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## UX guidance

Ask for chain changes only when the user starts an action that needs that chain. Do not force switching during page load.
