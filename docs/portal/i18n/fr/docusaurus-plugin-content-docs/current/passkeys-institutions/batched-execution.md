---
title: Exécution groupée
---

Les comptes intelligents passkey prennent en charge l'exécution groupée via `wallet_sendCalls`. Cela permet à l'utilisateur d'approuver plusieurs appels avec une seule vérification du portefeuille et une seule assertion WebAuthn.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="Vérification de lot passkey wallet_sendCalls de Pali avec calldata décodée" />
</a>
  <figcaption>Pali vérifie le lot passkey complet et décode les appels de jeton courants avant une seule approbation WebAuthn.</figcaption>
</figure>

## Exemple : approve et transferFrom

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## UX atomique

Lorsque `atomicRequired` vaut true, l'utilisateur doit approuver ou rejeter le lot complet. Le chemin passkey de Pali prépare tous les appels sélectionnés comme une seule exécution de compte intelligent. Les dapps ne doivent pas demander aux utilisateurs d'approuver des lots partiels lorsque la logique métier exige un comportement tout-ou-rien.

## Capacité de preuve de sponsor

Pour l'exécution passkey sponsorisée, une dapp peut transmettre une preuve de sponsor au niveau du lot via les capacités lorsque c'est applicable. Pali prend aussi en charge la résolution de service de sponsor via les métadonnées de sponsor stockées sur le compte.

## Type d'appel non pris en charge

`wallet_sendCalls` passkey ne prend pas en charge les appels de déploiement de contrat exprimés comme des transactions à cible vide. Déployez les contrats séparément ou utilisez un appel vers un contrat cible.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Flux de lot Passkey wallet_sendCalls"></video>
  <figcaption>Flux d'exécution de lot passkey : introduction de marque, appels décodés, une approbation passkey, résultat de transaction.</figcaption>
</figure>
