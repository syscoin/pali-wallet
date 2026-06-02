---
title: Активы и цепи
---

Pali поддерживает распространенные wallet methods для отслеживания активов и управления EVM-цепями.

## Отслеживать актив

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

Пользователь должен подтвердить актив перед тем, как он будет добавлен в Pali.

## Добавить EVM chain

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

## Переключить chain

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Рекомендации UX

Запрашивайте изменения цепи только когда пользователь начинает действие, которому нужна эта цепь. Не форсируйте переключение во время загрузки страницы.
