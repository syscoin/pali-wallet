---
title: Gas et financement
---

L’autorisation du compte intelligent et le paiement du gas sont séparés. Un passkey ou un validateur autorise l’action ; un compte financé paie les frais réseau.

## Modèle actuel

El flujo actual usa gas pagado por la wallet: despliegue, instalación de módulos, `wallet_sendCalls` y guardian recovery se envían con una cuenta local financiada. No anuncies una experiencia gasless salvo que una capability futura lo indique explícitamente.

## Conseils pour les dapps

Explica que Pali creará una cuenta inteligente, que el usuario aprobará la acción y que puede necesitar native token para despliegue o recuperación. No pases objetos legacy de patrocinio a `wallet_prepareSmartAccount`; la solicitud actual usa label y configuración de authenticator/módulos.
