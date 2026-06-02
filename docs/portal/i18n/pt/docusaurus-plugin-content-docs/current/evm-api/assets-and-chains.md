---
title: Ativos e chains
---

A Pali oferece suporte a métodos comuns de carteira para observar ativos e gerenciar chains EVM.

## Observar um ativo

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

O usuário deve aprovar o ativo antes que ele seja adicionado à Pali.

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

## Trocar chain

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Orientação de UX

Peça mudanças de chain apenas quando o usuário inicia uma ação que precisa dessa chain. Não force a troca durante o carregamento da página.
