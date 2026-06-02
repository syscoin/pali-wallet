---
title: Troca de rede
---

A Pali oferece suporte a troca de rede EVM, adição de chain EVM, troca de chain UTXO e troca de família UTXO/EVM.

## Adicionar uma chain EVM

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

## Trocar uma chain EVM

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Alternar entre famílias UTXO e EVM

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

## Orientação para dapps

Trate a troca de rede como uma aprovação do usuário. Evite trocar durante o carregamento da página. Solicite apenas depois que o usuário iniciar uma ação que exige a rede de destino.
