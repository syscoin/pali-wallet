---
title: Codes d'erreur
---

Pali utilise JSON-RPC, EIP-1193, EIP-1474 et des erreurs propres au portefeuille. Les dapps doivent toujours inspecter à la fois `error.code` et `error.message`.

## JSON-RPC standard

| Code | Signification |
| --- | --- |
| `-32700` | Erreur d'analyse. |
| `-32600` | Requête invalide. |
| `-32601` | Méthode introuvable ou indisponible. |
| `-32602` | Paramètres invalides. |
| `-32603` | Erreur interne. |

## Erreurs de provider Ethereum

| Code | Signification |
| --- | --- |
| `4001` | L'utilisateur a rejeté la requête. |
| `4100` | Compte ou méthode non autorisé. |
| `4200` | Méthode non prise en charge. |
| `4900` | Provider déconnecté. |
| `4901` | Provider déconnecté de la chaîne spécifiée. |

## Erreurs de style EIP-1474

| Code | Signification |
| --- | --- |
| `-32000` | Entrée invalide. |
| `-32001` | Ressource introuvable. |
| `-32002` | Ressource indisponible. |
| `-32003` | Transaction rejetée. |
| `-32004` | Méthode non prise en charge. |
| `-32005` | Limite de requêtes dépassée. |

## Erreurs courantes propres à Pali

| Code | Signification |
| --- | --- |
| `4101` | La méthode n'est disponible que pour une autre famille de chaînes, comme EVM uniquement ou UTXO uniquement. |
| `4874` | La méthode ne prend pas en charge les hardware wallets. |
| `5710` | La chaîne du bundle n'a pas de RPC configuré dans le wallet (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | Identifiant de bundle dupliqué fourni par la dapp dans `wallet_sendCalls`. |
| `5730` | Identifiant de bundle inconnu pour `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

## Bonnes pratiques

- Traitez `4001` comme une annulation utilisateur normale.
- Traitez `4101` comme une invitation à guider l'utilisateur vers la bonne famille de réseau.
- Ne réessayez pas les requêtes bloquantes dans une boucle serrée. Pali protège les utilisateurs contre le spam de popups.
- Affichez un texte actionnable pour les échecs de sponsor passkey, surtout en mode sponsor requis.
