---
title: PSBT and transactions
---

UTXO applications should construct transactions carefully, request a signature through Pali, and broadcast only after the user approves.

## Sign a PSBT

<figure>
  <a className="pali-media-link" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT signing review screen" />
</a>
  <figcaption>Pali prompts the user before signing UTXO PSBTs.</figcaption>
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

## Fetch transactions

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Validate an address

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Dapp responsibility

Pali signs what the user approves. Your application is responsible for constructing sane PSBT inputs, outputs, fees, change, and asset metadata before requesting a signature.

<figure className="pali-video-card">
  <video controls poster="/img/screens/utxo-psbt-flow-video.png" src="/video/utxo-psbt-flow.mp4" title="UTXO PSBT flow in Pali"></video>
  <figcaption>UTXO flow: branded intro, PSBT construction, Pali signing review, and broadcast result.</figcaption>
</figure>
