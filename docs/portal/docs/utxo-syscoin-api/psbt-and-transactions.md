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

## Account selection

Signing is bound to the account connected to the requesting dapp and the approved network. PSBT metadata cannot select another wallet account. If Pali is displaying a different account, it can ask the user to switch to the connected account before approval. To use another account, change the dapp connection and request a new approval.

For a PSBT with unfinished inputs, at least one unfinished input must belong to that approved account. Pali signs only that account's inputs. Shared and multisig transactions can therefore return partially signed; other participants must complete their own inputs or signatures. Existing external signatures and supported finalized inputs are preserved. A completely finalized PSBT can be returned without adding signatures. Hardware-wallet support still depends on the device and transaction format.

A change of account or network invalidates the pending signing context. Rebuild or recheck the request and obtain a fresh approval instead of replaying the old request.
