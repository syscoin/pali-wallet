---
title: PSBT und Transaktionen
---

UTXO-Anwendungen sollten Transaktionen sorgfältig konstruieren, eine Signatur über Pali anfordern und erst nach Benutzerfreigabe broadcasten.

## Eine PSBT signieren

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
      <img src="/img/screens/psbt-sign-review.png" alt="Pali-Prüfbildschirm für PSBT-Signatur" />
    </div>
  </div>
  <figcaption>Pali fragt den Benutzer, bevor UTXO-PSBTs signiert werden.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Signieren und senden

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Transaktionen abrufen

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Eine Adresse validieren

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Verantwortung der dapp

Pali signiert, was der Benutzer freigibt. Ihre Anwendung ist dafür verantwortlich, sinnvolle PSBT-Inputs, Outputs, Fees, Wechselgeld und Asset-Metadaten zu konstruieren, bevor sie eine Signatur anfordert.

