---
title: Modèle de sécurité
---

Pali est un portefeuille non dépositaire. Il n'expose pas les clés privées aux dapps. Les dapps envoient des requêtes au provider injecté, Pali valide et route ces requêtes, et les utilisateurs approuvent les actions sensibles dans l'interface de l'extension.

## Principes fondamentaux

- **Connexions limitées par origine :** les connexions sont stockées par hôte de dapp.
- **Un compte actif par dapp :** un site connecté a un seul compte actif à la fois, même si de nombreux sites peuvent être connectés.
- **Validations sérialisées :** les requêtes bloquantes qui ouvrent des popups sont coordonnées afin que les utilisateurs ne soient pas submergés par des validations concurrentes.
- **Vérifications de famille de réseau :** les méthodes EVM et les méthodes UTXO sont séparées. Les appels vers la mauvaise famille doivent être traités comme des erreurs de dapp récupérables.
- **Signature explicite :** les transactions, PSBTs, données typées, signatures de messages, créations de passkey, exécutions passkey, demandes de suivi d'actifs et changements de chaîne nécessitent le bon état du portefeuille et l'approbation de l'utilisateur.
- **Isolation du provider :** Pali injecte les providers dans la page de premier niveau. Il ne les injecte pas dans les iframes.

## Ce que les dapps reçoivent

Les dapps reçoivent des identifiants de compte publics, l'état du provider, des signatures, des hachages de transaction et des résultats RPC explicites. Elles ne reçoivent jamais de phrases de récupération, de clés privées, de matériel privé passkey ni de secrets d'authenticator.

## Sécurité des passkeys

Les comptes intelligents passkey utilisent des identifiants WebAuthn. Pali stocke des métadonnées publiques et des identifiants de credential ; le matériel de clé privée reste dans l'authenticator. Pali rejette les assertions WebAuthn inter-origines et vérifie que les hachages d'action passkey correspondent à l'ensemble de transactions préparé.

## Sécurité de la politique de sponsor

La politique de sponsor institutionnel est divisée en :

- **Politique on-chain :** mode, signataire sponsor et hachage d'URL.
- **Métadonnées du portefeuille :** URL du sponsor et texte de politique affiché.

Le champ `policyText` est montré aux utilisateurs comme contexte. Ce n'est pas un primitive d'application on-chain.
