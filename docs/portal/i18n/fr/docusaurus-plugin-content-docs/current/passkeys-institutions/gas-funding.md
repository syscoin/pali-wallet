---
title: Gas et financement
---

L’autorisation du compte intelligent et le paiement du gas sont séparés. Un passkey ou un validateur autorise l’action ; un compte financé paie les frais réseau.

## Modèle actuel

Le flux actuel utilise du gas payé par le wallet : le déploiement, l’installation de modules, `wallet_sendCalls` et la guardian recovery sont envoyés par un compte local financé. N’annoncez pas une expérience gasless sauf si une capability future indique explicitement le sponsoring.

## Gas zkSYS via paymaster

Sur les réseaux configurés comme zkTanenbaum, Pali peut payer les envois de smart account éligibles en zkSYS via un paymaster Pali. La première utilisation peut nécessiter une approbation zkSYS unique ; cette transaction de configuration peut encore nécessiter du gas natif. Si le sponsoring zkSYS est optionnel et indisponible, refusé ou dangereux pour l’opération demandée, Pali revient au gas natif. Les dapps doivent présenter cela comme du gas de smart account payé en zkSYS lorsque disponible, pas comme un flux entièrement gasless.

## Conseils pour les dapps

Expliquez que Pali créera un compte intelligent, que l’utilisateur approuvera l’action et qu’il peut avoir besoin de native token pour le déploiement ou la récupération. Ne transmettez pas d’objets legacy de sponsoring à `wallet_prepareSmartAccount` ; la demande actuelle utilise le label et la configuration de l’authenticator/des modules.
