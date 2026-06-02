---
title: Contas e estado
---

Dapps UTXO muitas vezes precisam de mais de um endereço. A Pali expõe estado de conta, informações de xpub e endereços de troco para que aplicações possam construir PSBTs corretas.

## Solicitar acesso à conta

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Obter detalhes da conta

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## Obter chave pública e dados de derivação

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

## Endereço de troco

```js
const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});
```

Você também pode usar:

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
