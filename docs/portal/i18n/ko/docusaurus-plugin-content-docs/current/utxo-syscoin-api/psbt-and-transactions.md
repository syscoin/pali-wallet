---
title: PSBT 및 transaction
---

UTXO application은 transaction을 신중하게 구성하고, Pali를 통해 signature를 요청하며, 사용자가 승인한 뒤에만 broadcast해야 합니다.

## PSBT 서명

<figure>
  <a className="pali-media-link" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT signing review 화면" />
</a>
  <figcaption>Pali는 UTXO PSBT에 서명하기 전에 사용자에게 prompt합니다.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Sign and send

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Transaction 가져오기

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Address 검증

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Dapp 책임

Pali는 사용자가 승인한 것에 서명합니다. 애플리케이션은 signature를 요청하기 전에 sane PSBT input, output, fee, change, asset metadata를 구성할 책임이 있습니다.

<figure className="pali-video-card">
  <video controls poster="/img/screens/utxo-psbt-flow-video.png" src="/video/utxo-psbt-flow.mp4" title="Pali의 UTXO PSBT flow"></video>
  <figcaption>UTXO flow: branded intro, PSBT construction, Pali signing review, broadcast result.</figcaption>
</figure>
