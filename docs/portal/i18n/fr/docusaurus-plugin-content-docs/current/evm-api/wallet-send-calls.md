---
title: wallet_sendCalls
---

Pali prend en charge `wallet_sendCalls` de style EIP-5792 pour les requêtes groupées EVM. C'est particulièrement important pour les comptes intelligents passkey, où plusieurs appels peuvent être autorisés avec une seule assertion WebAuthn.

## Vérifier les capacités

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali indique la prise en charge atomique pour les comptes intelligents passkey et l'absence de prise en charge de l'exécution atomique pour les EOAs ordinaires.

## Envoyer un lot

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
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## Comportement passkey

Pour les comptes intelligents passkey, Pali prépare tous les appels sélectionnés comme un seul lot d'exécution de compte intelligent, demande une seule assertion passkey et soumet une seule transaction. Si le compte n'est pas déployé, le déploiement et l'exécution de politique initiale optionnelle peuvent faire partie du premier chemin de transaction.

## Comportement EOA

Pour les comptes EVM ordinaires, Pali présente les appels et envoie les appels sélectionnés séquentiellement. Ce n'est pas équivalent à l'atomicité on-chain. Si une dapp exige une exécution réellement atomique, utilisez un compte intelligent passkey ou un contrat conçu pour grouper des appels atomiquement.

## Méthodes d'état

`wallet_getCallsStatus` et `wallet_showCallsStatus` sont implémentés conformément à EIP-5792. `wallet_getCallsStatus` retourne l'objet de statut standard (`100` en attente, `200` confirmé, `500` reverté, `600` partiellement reverté) avec les receipts on-chain ; `wallet_showCallsStatus` ouvre un popup Pali en lecture seule avec les mêmes informations. Les `id` fournis par la dapp dans `wallet_sendCalls` sont respectés et retournés. Les identifiants de bundle inconnus échouent avec l'erreur `5730` ; les identifiants dupliqués fournis par la dapp, avec `5720`.
