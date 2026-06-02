---
title: События
---

Подписывайтесь на события после выбора провайдера.

## События EIP-1193

| Событие | Provider | Значение |
| --- | --- | --- |
| `connect` | `window.ethereum` | Провайдер подключен. |
| `disconnect` | `window.ethereum` | Провайдер отключен. |
| `accountsChanged` | `window.ethereum` | Список EVM accounts изменился. |
| `chainChanged` | `window.ethereum` | EVM chain изменилась. |
| `message` | `window.ethereum` | Provider message. |

## Уведомления Pali wallet

| Событие | Значение |
| --- | --- |
| `pali_accountsChanged` | Подключенный аккаунт изменился. |
| `pali_chainChanged` | Активная chain изменилась. |
| `pali_unlockStateChanged` | Состояние блокировки кошелька изменилось. |
| `pali_isBitcoinBased` | Состояние активного UTXO family изменилось. |
| `pali_xpubChanged` | Подключенный UTXO xpub изменился. |
| `pali_blockExplorerChanged` | Активный block explorer изменился. |
| `walletUpdate` | Уведомление об обновлении состояния кошелька. |

## Пример

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

Удаляйте listeners, когда ваш component unmounts, чтобы избежать дублированных обновлений состояния.
