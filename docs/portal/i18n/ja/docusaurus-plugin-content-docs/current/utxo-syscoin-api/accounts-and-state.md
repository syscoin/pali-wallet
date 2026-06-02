---
title: アカウントと状態
---

UTXO dappsは多くの場合、複数のアドレスを必要とします。Paliは、アプリケーションが正しいPSBTを構築できるよう、アカウント状態、xpub情報、変更アドレスを公開します。

## アカウントアクセスをリクエストする

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## アカウント詳細を取得する

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## 公開鍵と派生データを取得する

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

## 変更アドレス

```js
const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});
```

次も使用できます。

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
