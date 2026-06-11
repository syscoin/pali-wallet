---
title: Particularités et limites
---

Cette page documente les comportements dont les dapps doivent tenir compte.

## Connexions et popups

- De nombreux hôtes de dapp peuvent être connectés.
- Chaque hôte a un seul compte connecté actif à la fois.
- Les popups d'approbation bloquantes sont sérialisées et mises en file.
- Les routes de popup actives en double peuvent être rejetées.
- Le spam de popups peut être temporairement bloqué.

## Séparation UTXO et EVM

- `window.ethereum` est destiné à EVM.
- `window.pali` est destiné à UTXO/Syscoin.
- Appeler une méthode depuis la mauvaise famille de chaînes peut échouer ou nécessiter un changement de réseau.
- Le changement UTXO/EVM peut déconnecter et exiger une reconnexion.

## État EIP-5792

- `wallet_sendCalls` est implémenté.
- `wallet_getCapabilities` est implémenté.
- `wallet_getCallsStatus` est implémenté ; les identifiants de bundle inconnus échouent avec l'erreur `5730`.
- `wallet_showCallsStatus` est implémenté et affiche le statut du batch dans un popup du wallet.

## Atomicité

- Les comptes intelligents passkey peuvent exécuter des appels groupés sélectionnés via une seule exécution de compte intelligent.
- Les appels groupés EOA ordinaires sont des envois séquentiels du portefeuille et ne doivent pas être traités comme une véritable exécution atomique.

## Subscriptions

`eth_subscribe` et `eth_unsubscribe` ne sont pas pris en charge. Utilisez un provider RPC WebSocket dédié pour les subscriptions de chaîne en temps réel.

## Passkeys

- La prise en charge des comptes intelligents passkey dépend de la configuration de factory pour la chaîne active.
- Les appels de déploiement de contrat ne sont pas pris en charge via `wallet_sendCalls` passkey.
- `policyText` est une métadonnée du portefeuille et un texte d'affichage, pas une application on-chain.
- Le mode sponsor requis dépend de la disponibilité du service de sponsor et de la validation de preuve.

## Iframes

Pali injecte les providers dans les pages de premier niveau, pas dans les iframes.
