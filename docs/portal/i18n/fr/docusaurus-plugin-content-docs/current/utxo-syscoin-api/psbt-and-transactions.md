---
title: PSBT et transactions
---

Les applications UTXO doivent construire les transactions soigneusement, demander une signature via Pali et ne diffuser qu'après l'approbation de l'utilisateur.

## Signer un PSBT

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
      <img src="/img/screens/psbt-sign-review.png" alt="Écran de vérification de signature PSBT de Pali" />
    </div>
  </div>
  <figcaption>Pali demande confirmation à l'utilisateur avant de signer les PSBTs UTXO.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Signer et envoyer

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Récupérer des transactions

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Valider une adresse

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Responsabilité de la dapp

Pali signe ce que l'utilisateur approuve. Votre application est responsable de construire des entrées, sorties, frais, rendu de monnaie et métadonnées d'actifs PSBT cohérents avant de demander une signature.

