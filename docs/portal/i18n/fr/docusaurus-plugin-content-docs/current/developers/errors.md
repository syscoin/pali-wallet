---
title: Erreurs
---

Encapsulez toujours les requêtes de provider dans `try` / `catch`. Pali utilise autant que possible les erreurs standard de style JSON-RPC et EIP-1193, ainsi que des erreurs propres au portefeuille pour les réseaux non pris en charge, les restrictions de hardware wallet et les états passkey.

```js
try {
  await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx],
  });
} catch (error) {
  switch (error.code) {
    case 4001:
      console.log('User rejected the request.');
      break;
    case 4100:
      console.log('The dapp is not authorized.');
      break;
    case 4200:
      console.log('The method is unsupported.');
      break;
    default:
      console.error(error);
  }
}
```

## Catégories courantes

| Code | Signification |
| --- | --- |
| `4001` | L'utilisateur a rejeté la requête. |
| `4100` | Compte ou méthode non autorisé. |
| `4101` | La méthode n'est disponible que pour une autre famille de chaînes. |
| `4200` | Méthode non prise en charge. |
| `4900` | Provider déconnecté. |
| `4901` | Provider déconnecté de la chaîne demandée. |
| `5710` | La chaîne du bundle EIP-5792 n'a pas de RPC configuré dans le wallet (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | Identifiant de bundle EIP-5792 dupliqué fourni par la dapp dans `wallet_sendCalls`. |
| `5730` | Identifiant de bundle EIP-5792 inconnu dans `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

Voir [Codes d'erreur](../reference/error-codes.md) pour la référence plus longue.

## Réessayer des demandes interrompues

Un délai dépassé, une fenêtre d’approbation fermée ou une connexion perdue ne prouvent pas toujours qu’une transaction n’a jamais été soumise. Avant de demander une autre signature ou un autre envoi, vérifiez tout hash de transaction connu, l’historique des transactions ou l’état du lot. Une diffusion dont l’envoi a été confirmé par le fournisseur reste réussie même si une mise à jour ultérieure de l’historique local échoue.

Réessayez les lectures ordinaires lorsque cela convient, mais ne rejouez pas automatiquement les demandes de signature, de création de portefeuille ou de diffusion après un résultat incertain. Si le compte ou le réseau a changé, obtenez une nouvelle approbation pour le contexte actuel. Pour une configuration de compte intelligent en attente, vérifiez son état sur le réseau d’origine avant de tenter un autre déploiement.
