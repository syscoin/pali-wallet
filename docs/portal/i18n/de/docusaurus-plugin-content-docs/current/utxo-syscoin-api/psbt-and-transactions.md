---
title: PSBT und Transaktionen
---

UTXO-Anwendungen sollten Transaktionen sorgfältig konstruieren, eine Signatur über Pali anfordern und erst nach Benutzerfreigabe broadcasten.

## Eine PSBT signieren

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <span className="pali-capture-card__icon">P</span>
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__title">PSBT-Signaturprüfung</p>
      <p className="pali-capture-card__subtitle">UTXO-Signaturbestätigung mit erweiterten Transaktionsdetails.</p>
      <p className="pali-capture-card__hint">Im Vorschaubereich scrollen, um Outputs, Inputs, Größe, Gewicht und Lock Time zu prüfen.</p>
    </div>
    <a className="pali-capture-card__scroll" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
      <img src="/img/screens/psbt-sign-review.png" alt="Pali-Prüfbildschirm für PSBT-Signatur" />
    </a>
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

