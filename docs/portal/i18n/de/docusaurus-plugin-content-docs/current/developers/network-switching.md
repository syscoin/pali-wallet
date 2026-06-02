---
title: Netzwerkwechsel
---

Pali unterstützt EVM-Netzwerkwechsel, das Hinzufügen von EVM-Chains, UTXO-Chain-Wechsel und UTXO/EVM-Familienwechsel.

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

## Eine EVM-Chain wechseln

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Zwischen UTXO- und EVM-Familie wechseln

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

## dapp-Empfehlung

Behandeln Sie Netzwerkwechsel als Benutzerfreigabe. Vermeiden Sie Wechsel beim Laden der Seite. Fragen Sie nur, nachdem der Benutzer eine Aktion initiiert hat, die das Zielnetzwerk erfordert.
