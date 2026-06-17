---
title: Signataire post-quantique pour comptes intelligents
---

Les comptes intelligents Pali peuvent utiliser différents validateurs. L'un d'eux est un signataire post-quantique local basé sur **SLH-DSA-SHA2-128s**, une famille de signatures à base de hachage standardisée par le NIST dans FIPS 205.

En clair : cela permet à un compte intelligent d'approuver des actions avec une signature conçue pour résister aux attaques quantiques connues contre les signatures ECDSA actuelles.

:::caution Note alpha
Les comptes intelligents Pali et le validateur SLH-DSA sont encore une infrastructure précoce. Commencez sur des réseaux de test compatibles ou avec de petits soldes, gardez une voie de récupération ou un validateur de secours, et attendez-vous à une configuration/signature plus lente qu'une signature normale.
:::

## Ce qui change

Avec un compte EVM normal, une clé privée ECDSA contrôle l'adresse. Avec un compte intelligent, l'adresse est un contrat et un validateur décide ce qui compte comme approbation. Ce validateur peut être ECDSA, passkey, une politique composite ou SLH-DSA.

Ce qui reste identique :

- L'adresse du compte intelligent reste la même.
- Les dapps voient toujours une seule adresse EVM.
- Pali affiche toujours une demande à vérifier avant de signer.
- La récupération par gardiens et la rotation des validateurs restent disponibles.

Ce qui change :

- La configuration prend plus de temps car Pali prépare un cache local.
- La signature peut prendre plus de temps qu'ECDSA ou les passkeys.
- L'état local du signataire doit rester disponible sur l'appareil, ou il faut le régénérer.

## Comment l'activer

1. Ouvrez Pali et passez sur un réseau EVM compatible.
2. Ouvrez **Settings**.
3. Ouvrez l'écran du compte intelligent ou de la politique.
4. Choisissez **Post-quantum / SLH-DSA**.
5. Gardez Pali ouvert pendant la préparation du cache.
6. Vérifiez puis envoyez la transaction de changement de validateur.

Si Pali indique que le signataire local manque ou ne correspond pas au validateur actif, régénérez l'état du signataire depuis l'écran de politique.

## Limite de signatures

Le profil SLH-DSA actuel a une capacité absolue de `2^24` signatures par signataire local préparé. Pali réserve `1,000` signatures pour les tentatives de rotation hors de cette clé, donc la signature normale s'arrête à `2^24 - 1,000`. Cela reste plus de 16 millions de signatures ; un utilisateur normal ne devrait donc pas atteindre cette limite.

Si le budget normal est épuisé, Pali cesse de signer les opérations normales avec cette clé et conserve la réserve pour les tentatives de rotation du validateur. Pali ne signe pas silencieusement avec un signataire épuisé.

## Références

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [Projet post-quantique du NIST](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
