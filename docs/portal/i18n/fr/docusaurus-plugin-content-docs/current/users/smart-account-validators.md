---
title: Comptes intelligents et passkeys
---

Les comptes intelligents Pali sont des comptes de contrat EVM contrôlés par des modules. Un passkey est une manière prise en charge de les contrôler ; ils peuvent aussi utiliser ECDSA ou des politiques composites.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>Les utilisateurs peuvent créer des comptes intelligents modulaires depuis les Réglages ou via une demande de dapp, puis choisir le validateur qui contrôle les approbations.</figcaption>
</figure>

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

La guardian recovery n'est pas instantanée. Un gardien signe une intention, le module la planifie avec un délai, puis n'importe qui peut finaliser le remplacement du validateur. Pali utilise un sel nouveau à chaque tentative et n'autorise qu'une seule récupération active par compte.

On-chain, un gardien ne se limite pas à une clé normale : les approbations des gardiens sont vérifiées via ECDSA ou ERC-1271, donc un gardien peut aussi être un compte de contrat déployé — y compris un autre compte intelligent dont la propre politique est un validateur composite, personnalisé ou post-quantique. Le chemin de récupération hérite alors du schéma de signature de ce gardien. Les écrans actuels des gardiens de Pali collectent des approbations basées sur des clés ; les flux pour gardiens de type compte de contrat pourront être ajoutés plus tard, car le module déployé les prend déjà en charge.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>L'écran de politique du compte intelligent affiche les modules installés, les détails du validateur actif, la guardian recovery et la gestion des modules.</figcaption>
</figure>
