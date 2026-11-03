---
title: Signataire post-quantique pour comptes intelligents
---

Le signataire local utilise **SLH-DSA-SHA2-128-24**, un profil expérimental à nombre limité de signatures proposé dans le projet initial [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd). Il ne s’agit pas d’un jeu de paramètres à usage général approuvé par FIPS 205.

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

La limite de `2^24` signatures vaut pour toute la durée de vie de la clé, tous usages et toutes copies confondus. Pali réserve `1,000` signatures à la rotation ; la signature normale s’arrête à `2^24 - 1,000` signatures enregistrées localement. La régénération conserve l’historique local disponible, mais une restauration à partir de la seule phrase de récupération ou d’une ancienne sauvegarde ne retrouve pas l’historique manquant, et les appareils ne synchronisent pas leurs compteurs. La limite globale n’est donc pas garantie dans ces cas.

Si le budget normal est épuisé, Pali cesse de signer les opérations normales avec cette clé et conserve la réserve pour les tentatives de rotation du validateur. Pali ne signe pas silencieusement avec un signataire épuisé.

## Références

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [Projet post-quantique du NIST](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
