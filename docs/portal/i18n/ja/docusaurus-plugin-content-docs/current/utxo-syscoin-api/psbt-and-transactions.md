---
title: PSBTとトランザクション
---

UTXOアプリケーションは、トランザクションを慎重に構築し、Paliを通じて署名をリクエストし、ユーザー承認後にのみブロードキャストする必要があります。

## PSBTに署名する

<figure>
  <a className="pali-media-link" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT signing review screen" />
</a>
  <figcaption>PaliはUTXO PSBTsに署名する前にユーザーへ確認を求めます。</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## 署名して送信する

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## トランザクションを取得する

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## アドレスを検証する

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## dappの責任

Paliはユーザーが承認したものに署名します。アプリケーションは、署名をリクエストする前に、妥当なPSBT入力、出力、fees、change、アセットメタデータを構築する責任があります。

