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
      <p className="pali-capture-card__title">Vérification de signature PSBT</p>
      <p className="pali-capture-card__subtitle">Confirmation de signature UTXO</p>
      <p className="pali-capture-card__hint">Faites défiler l’aperçu pour examiner les sorties, les entrées, la taille, le poids et le temps de verrouillage.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Écran de vérification de signature PSBT de Pali" />
    </div>
  </div>
  <figcaption>Pali demande confirmation à l’utilisateur avant de signer les PSBT UTXO.</figcaption>
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

## Sélection du compte

La signature est liée au compte connecté à la dapp demandeuse et au réseau approuvé. Les métadonnées d’un PSBT ne peuvent pas sélectionner un autre compte du portefeuille. Si Pali affiche un compte différent, il peut demander à l’utilisateur de passer au compte connecté avant l’approbation. Pour utiliser un autre compte, modifiez la connexion de la dapp et demandez une nouvelle approbation.

Pour un PSBT contenant des entrées non finalisées, au moins une entrée non finalisée doit appartenir au compte approuvé. Pali signe uniquement les entrées de ce compte. Les transactions partagées et multisignatures peuvent donc être renvoyées partiellement signées ; les autres participants doivent compléter leurs propres entrées ou signatures. Les signatures externes existantes et les entrées finalisées prises en charge sont conservées. Un PSBT entièrement finalisé peut être renvoyé sans ajouter de signatures. La prise en charge des portefeuilles matériels dépend toujours de l’appareil et du format de transaction.

Un changement de compte ou de réseau invalide le contexte de signature en attente. Reconstruisez ou vérifiez à nouveau la demande et obtenez une nouvelle approbation au lieu de rejouer l’ancienne demande.
