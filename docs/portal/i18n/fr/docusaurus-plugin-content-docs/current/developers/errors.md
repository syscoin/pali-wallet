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
| `5730` | Identifiant de bundle EIP-5792 inconnu dans `wallet_getCallsStatus`. |

Voir [Codes d'erreur](../reference/error-codes.md) pour la référence plus longue.
