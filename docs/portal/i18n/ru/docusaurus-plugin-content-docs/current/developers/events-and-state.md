---
title: События и состояние провайдера
---

Слушайте события провайдера, чтобы ваше приложение оставалось синхронизированным, когда пользователь меняет аккаунт, сеть, состояние блокировки или UTXO state.

## События EVM

```js
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('EVM accounts', accounts);
});

window.ethereum.on('chainChanged', (chainId) => {
  console.log('EVM chain', chainId);
});

window.ethereum.on('disconnect', (error) => {
  console.warn('Provider disconnected', error);
});
```

## Пользовательские события Pali

Pali также эмитит пользовательские wallet notifications, используемые провайдером расширения.

| Событие | Значение |
| --- | --- |
| `pali_accountsChanged` | Подключенный аккаунт изменился. |
| `pali_chainChanged` | Активная цепь изменилась. |
| `pali_unlockStateChanged` | Состояние блокировки кошелька изменилось. |
| `pali_isBitcoinBased` | Активное UTXO family изменилось. |
| `pali_xpubChanged` | Подключенный UTXO xpub изменился. |
| `pali_blockExplorerChanged` | Активный UTXO explorer изменился. |

## Методы состояния провайдера

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

Provider state полезен для инициализации, но не рассматривайте его как замену явным проверкам account permission.
