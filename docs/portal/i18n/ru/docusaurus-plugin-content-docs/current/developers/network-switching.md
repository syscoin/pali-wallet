---
title: Переключение сетей
---

Pali поддерживает переключение EVM-сетей, добавление EVM-цепей, переключение UTXO-цепей и переключение между UTXO/EVM семействами.

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

## Переключить EVM chain

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## Переключиться между UTXO и EVM family

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

## Рекомендации для dapp

Относитесь к переключению сети как к подтверждению пользователя. Избегайте переключения при загрузке страницы. Запрашивайте его только после того, как пользователь инициировал действие, требующее целевую сеть.
