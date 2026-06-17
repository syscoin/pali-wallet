---
title: Comptes intelligents SLH-DSA
---

Les comptes intelligents Pali prennent en charge des validateurs modulaires. Le validateur post-quantique utilise des signatures locales **SLH-DSA-SHA2-128s** gérées par Pali. Dans les API, l'identifiant d'authentificateur est `slh-dsa`.

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
