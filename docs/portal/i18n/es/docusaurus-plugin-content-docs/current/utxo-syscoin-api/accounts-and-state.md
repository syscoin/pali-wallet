---
title: Cuentas y estado
---

Las dapps UTXO a menudo necesitan más de una dirección. Pali expone estado de cuenta, información xpub y direcciones de cambio para que las aplicaciones puedan construir PSBTs correctas.

## Solicitar acceso a cuenta

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Obtener detalles de cuenta

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## Obtener clave pública y datos de derivación

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

## Dirección de cambio

```js
const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});
```

También puedes usar:

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
