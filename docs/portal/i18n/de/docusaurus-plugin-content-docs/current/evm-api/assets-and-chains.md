---
title: Assets und Chains
---

Pali unterstützt gängige Wallet-Methoden zum Beobachten von Assets und Verwalten von EVM-Chains.

## Ein Asset beobachten

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

Der Benutzer muss das Asset freigeben, bevor es zu Pali hinzugefügt wird.

## Eine EVM-Chain hinzufügen

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

## Chain wechseln

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## UX-Empfehlung

Fragen Sie nach Chain-Änderungen nur, wenn der Benutzer eine Aktion startet, die diese Chain benötigt. Erzwingen Sie keinen Wechsel während des Ladens der Seite.
