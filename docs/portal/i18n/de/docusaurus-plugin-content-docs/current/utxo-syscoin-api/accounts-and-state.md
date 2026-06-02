---
title: Accounts und Zustand
---

UTXO-dapps benötigen häufig mehr als eine Adresse. Pali stellt Account-Zustand, xpub-Informationen und Wechselgeldadressen bereit, damit Anwendungen korrekte PSBTs erstellen können.

## Account-Zugriff anfordern

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Account-Details abrufen

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## Public Key und Ableitungsdaten abrufen

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

## Wechselgeldadresse

```js
const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});
```

Sie können auch Folgendes verwenden:

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
