---
title: Аккаунты и состояние
---

UTXO dapps часто нужны больше чем один адрес. Pali предоставляет account state, xpub information и change addresses, чтобы приложения могли строить корректные PSBTs.

## Запросить доступ к аккаунту

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Получить детали аккаунта

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## Получить public key и derivation data

```js
const publicKey = await window.pali.request({
  method: 'sys_getPublicKey',
});

const currentAddressPubkey = await window.pali.request({
  method: 'sys_getCurrentAddressPubkey',
});

const bip32Path = await window.pali.request({
  method: 'sys_getBip32Path',
});
```

## Change address

```js
const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});
```

Вы также можете использовать:

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
