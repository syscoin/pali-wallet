---
title: Comptes et état
---

Les dapps UTXO ont souvent besoin de plus d'une adresse. Pali expose l'état du compte, les informations xpub et les adresses de rendu de monnaie afin que les applications puissent construire des PSBTs corrects.

## Demander l'accès au compte

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Obtenir les détails du compte

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## Obtenir la clé publique et les données de dérivation

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

## Adresse de rendu de monnaie

```js
const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});
```

Vous pouvez aussi utiliser :

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
