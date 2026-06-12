---
title: PSBT and transactions
---

UTXO applications should construct transactions carefully, request a signature through Pali, and broadcast only after the user approves.

## Sign a PSBT

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">PSBT Sign Review</p>
      <p className="pali-capture-card__subtitle">UTXO signing confirmation</p>
      <p className="pali-capture-card__hint">Scroll inside the preview to inspect outputs, inputs, size, weight, and lock time.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT signing review screen" />
    </div>
  </div>
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

