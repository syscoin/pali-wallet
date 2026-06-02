---
title: Подключение аккаунтов
---

Запросы подключения Pali — это явные подтверждения пользователя. Dapps должны запрашивать доступ только когда пользователь нажимает кнопку подключения.

## Подключение EVM

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Подключение UTXO

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Чтение состояния подключения

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## Один активный аккаунт на dapp

Pali может держать подключенными много dapp origins. Для одного origin Pali отслеживает один активный подключенный аккаунт. Если чувствительный запрос ссылается на другой адрес `from`, Pali может попросить пользователя переключить подключение dapp.

## Отключение

Для EVM permissions `wallet_revokePermissions` отключает dapp от Pali.

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
