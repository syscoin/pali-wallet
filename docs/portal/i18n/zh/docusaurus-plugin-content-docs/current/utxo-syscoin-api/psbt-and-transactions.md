---
title: PSBT 和交易
---

UTXO 应用应仔细构造交易，通过 Pali 请求签名，并且只在用户批准后广播。

## 签名 PSBT

<figure>
  <a className="pali-media-link" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT 签名审核界面" />
</a>
  <figcaption>Pali 会在签名 UTXO PSBT 之前提示用户。</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## 签名并发送

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## 获取交易

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## 验证地址

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## dapp 责任

Pali 会签署用户批准的内容。你的应用负责在请求签名前构造合理的 PSBT inputs、outputs、fees、change 和 asset metadata。

