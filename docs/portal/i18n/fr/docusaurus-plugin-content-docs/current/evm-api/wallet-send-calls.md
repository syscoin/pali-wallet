---
title: wallet_sendCalls
---

Pali prend en charge `wallet_sendCalls` de type EIP-5792 pour les lots EVM. Un compte intelligent Pali compatible peut autoriser plusieurs appels en une exécution.

## Vérifier les capacités

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali indique la prise en charge atomique des comptes intelligents Pali compatibles et l’absence d’exécution atomique pour les EOA ordinaires.

## Envoyer un lot

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
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

## Comportement des comptes intelligents

L’utilisateur approuve ou refuse le lot demandé dans son ensemble ; il ne peut pas désélectionner les appels individuels. Pour un compte intelligent Pali, Pali prépare tout le lot en une exécution, demande l’autorisation du validateur actif, vérifie les destinations par rapport à la liste de blocage du portefeuille et soumet une transaction. Un validateur passkey utilise une assertion WebAuthn ; les propriétaires ECDSA locaux configurés signent le hachage de l’action.

## Comportement EOA

Pour un compte EVM ordinaire, Pali présente le lot entier à approuver ou à refuser et envoie ses appels séquentiellement. Ce n’est pas une exécution atomique on-chain. Si la dapp exige l’atomicité, utilisez un compte intelligent Pali compatible ou un contrat conçu pour les lots atomiques.

## Méthodes d'état

`wallet_getCallsStatus` et `wallet_showCallsStatus` sont implémentés conformément à EIP-5792. `wallet_getCallsStatus` retourne l'objet de statut standard (`100` en attente, `200` confirmé, `500` reverté, `600` partiellement reverté) avec les receipts on-chain ; `wallet_showCallsStatus` ouvre un popup Pali en lecture seule avec les mêmes informations. Les `id` fournis par la dapp dans `wallet_sendCalls` sont respectés et retournés. Les identifiants de bundle inconnus échouent avec l'erreur `5730` ; les identifiants dupliqués fournis par la dapp, avec `5720`.
