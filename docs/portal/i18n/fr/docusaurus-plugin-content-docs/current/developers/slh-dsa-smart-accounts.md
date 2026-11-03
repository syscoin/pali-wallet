---
title: Comptes intelligents SLH-DSA
---

Les comptes intelligents Pali prennent en charge des validateurs modulaires. Le validateur post-quantique utilise des signatures locales **SLH-DSA-SHA2-128-24** gérées par Pali. Dans les API, l'identifiant d'authentificateur est `slh-dsa`.

Le signataire local utilise **SLH-DSA-SHA2-128-24**, un profil expérimental à nombre limité de signatures proposé dans le projet initial [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd). Il ne s’agit pas d’un jeu de paramètres à usage général approuvé par FIPS 205. La limite de `2^24` signatures vaut pour toute la durée de vie de la clé, tous usages et toutes copies confondus. Pali réserve `1,000` signatures à la rotation ; la signature normale s’arrête à `2^24 - 1,000` signatures enregistrées localement. La régénération conserve l’historique local disponible, mais une restauration à partir de la seule phrase de récupération ou d’une ancienne sauvegarde ne retrouve pas l’historique manquant, et les appareils ne synchronisent pas leurs compteurs. La limite globale n’est donc pas garantie dans ces cas.

:::caution Note alpha
Les comptes intelligents Pali et SLH-DSA sont encore une infrastructure précoce. Utilisez d'abord des réseaux de test compatibles ou de petits soldes, gardez une récupération ou un validateur de secours, et ne basez pas l'UX dapp sur des temps fixes de configuration ou de signature.
:::

## Requête dapp

Demandez un compte intelligent avec `wallet_prepareSmartAccount` :

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Compte post-quantique de test',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

N'incluez pas `keyId`, `pkSeed`, `pkRoot` ni de matériel de clé SLH-DSA. Pali génère et gère le signataire local. Les clés SLH-DSA fournies par une dapp sont rejetées afin d'éviter des comptes que Pali ne pourrait pas signer.

## Flux de signature

Pali signe le hash d'action du compte intelligent avec le signataire SLH-DSA local. Avant de signer, Pali vérifie le compte cible, les métadonnées hydratées, le validateur actif `slh-dsa`, la correspondance de la clé publique et la capacité de la session à déchiffrer l'état local.

Si une vérification échoue, Pali refuse de signer et demande de régénérer l'état local ou d'utiliser une autre méthode d'approbation.

## Limites et gas

- capacité absolue par clé : `2^24`;
- limite de signature normale : `2^24 - 1,000`;
- signatures réservées à la rotation : `1,000`;
- taille de signature : `3,856` octets;
- `preVerificationGas` SLH-DSA : `130,000`;
- `verificationGasLimit` SLH-DSA : `700,000` comme limite prudente.

Quand `signatureCount >= signatureLimit`, Pali cesse de signer les opérations normales avec cette clé et n'autorise le budget réservé que pour des exécutions explicites de `rotateValidator`. Les dapps ne doivent pas supposer des temps de signature fixes.

## Références

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
