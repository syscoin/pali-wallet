---
title: Accounts and state
---

UTXO dapps often need more than one address. Pali exposes account state, xpub information, and change addresses so applications can build correct PSBTs.

## Request account access

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Get account details

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## Get public key and derivation data

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

You can also use:

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
