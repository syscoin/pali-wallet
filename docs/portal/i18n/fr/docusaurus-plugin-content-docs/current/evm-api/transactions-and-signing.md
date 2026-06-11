---
title: Transactions et signature
---

Utilisez le provider EVM pour les transactions, les messages personnels et les données typées.

## Envoyer une transaction

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Écran de vérification de transaction EVM de Pali" />
</a>
  <figcaption>Les demandes de transaction sont vérifiées dans Pali avant la signature et la diffusion.</figcaption>
</figure>

```js
const [from] = await window.ethereum.request({
  method: 'eth_requestAccounts',
});

const hash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [
    {
      from,
      to: '0x0000000000000000000000000000000000000000',
      value: '0x0',
      data: '0x',
    },
  ],
});
```

## Personal sign

```js
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f2050616c69', from],
});
```

## Signature de données typées

<figure>
  <a className="pali-media-link" href="/img/screens/typed-data-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/typed-data-review.png" alt="Écran de vérification de signature de données typées de Pali" />
</a>
  <figcaption>Pali valide et affiche les données typées avant l'approbation de l'utilisateur.</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Pali valide la structure des données typées avant d'afficher la popup de signature. Les dapps doivent utiliser du JSON EIP-712 canonique et éviter de dépendre de particularités d'analyse propres à un portefeuille.

## Comptes intelligents et signature

Les comptes intelligents Pali approuvent les transactions et les flux de signature via le module validateur actif. L'utilisateur approuve toujours dans Pali. Si le validateur repose sur une passkey, le navigateur ou le système d'exploitation affiche aussi une invite WebAuthn.
