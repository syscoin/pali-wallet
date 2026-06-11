---
title: Comptes intelligents et passkeys
---

Les comptes intelligents Pali sont des comptes de contrat EVM contrôlés par des modules. Un passkey est une manière prise en charge de les contrôler ; ils peuvent aussi utiliser ECDSA ou des politiques composites.

## Pourquoi les utiliser

- Aprobaciones con passkey para uso diario.
- Owners ECDSA cuando una wallet o equipo debe controlar la cuenta.
- Validadores composite para co-gestión.
- Acciones por lote y guardian recovery.

Considérez les validateurs comme la réponse à la question « qui peut approuver des actions pour ce compte ? » — et l'utile, c'est que la réponse peut changer sans changer votre compte :

- **N'importe lequel de mes moyens de connexion** (1-of-N) : approuvez avec le passkey ou la clé qui est à portée de main.
- **Quelques-uns d'entre nous ensemble** (t-of-N) : un quorum de personnes ou d'appareils doit être d'accord, idéal pour des fonds partagés.
- **Nous tous ensemble** (N-of-N) : chaque moyen de connexion configuré doit approuver, pour les comptes les plus sensibles.

Les politiques peuvent même contenir d'autres politiques, donc une équipe peut exprimer des choses comme « la clé du responsable plus deux passkeys du desk ». Votre adresse, vos soldes et votre historique restent exactement les mêmes quand la politique change — et comme la signature est modulaire, de futurs types de signature (y compris post-quantiques) pourront être adoptés plus tard sur le même compte.

Les gardiens ne font volontairement **pas** partie de cette liste. Un gardien ne peut jamais approuver une transaction ; son seul pouvoir est de lancer une récupération lente et visible si vous perdez l'accès. Cette séparation vous protège contre la perte d'accès sans donner à quiconque un contrôle au quotidien.

## Déploiement

Pali deriva la dirección de forma determinista, despliega mediante la factory y guarda metadatos duraderos. El despliegue empieza con un validador bootstrap ECDSA de la wallet; luego Pali instala el validador solicitado si es distinto.

## Guardian recovery

Guardian recovery no es instantáneo. Un guardian firma una intención, el módulo la programa con delay, y después cualquiera puede finalizar el reemplazo del validador. Pali usa una sal nueva por intento y solo permite una recovery activa por cuenta.
