---
title: Разрешения
---

Pali поддерживает разрешения в стиле EIP-2255 для EVM dapps.

## Запросить разрешения

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

Большинство dapps могут использовать вместо этого `eth_requestAccounts`. Используйте `wallet_requestPermissions`, когда вам нужны явные permission objects и permitted-chain metadata.

## Получить разрешения

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## Отозвать разрешения

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

В Pali отзыв отключает dapp от кошелька. Рассматривайте это как полное отключение сайта, а не granular partial permission editing.

## Переключение аккаунта

Для блокирующих методов, таких как отправка транзакций и подписание, Pali проверяет, что подключенный dapp account соответствует аккаунту, запрошенному dapp. Если dapp отправляет адрес `from`, который не является активным подключенным аккаунтом, Pali может предложить пользователю переключить подключение dapp.
