---
title: Account 및 state
---

UTXO dapp에는 주소가 하나 이상 필요한 경우가 많습니다. Pali는 애플리케이션이 올바른 PSBT를 만들 수 있도록 account state, xpub information, change address를 노출합니다.

## Account access 요청

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Account detail 가져오기

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## Public key 및 derivation data 가져오기

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

다음도 사용할 수 있습니다.

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
