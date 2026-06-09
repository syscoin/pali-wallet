---
title: Tester avec Pali
---

Utilisez la dapp de test Syscoin pour les tests d'intégration manuels et vos propres tests automatisés pour la logique applicative.

## Dapp de test hébergée

La dapp de test Syscoin est hébergée à l'adresse :

```text
https://syscoin-test-dapp.vercel.app/
```

Elle inclut les flux passkey Pali, `wallet_prepareSmartAccount`, `wallet_sendCalls`, la génération de lots d'allowance ERC-20 et les requêtes de portefeuille courantes.

## Dapp de test locale

Si vous devez tester des changements non publiés :

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## Extension Pali locale

```bash
git clone https://github.com/syscoin/pali_wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

Chargez ensuite `build/chrome` via la page développeur des extensions du navigateur.

## Checklist de test passkey

1. Connectez Pali via le sélecteur de provider par défaut.
2. Créez ou récupérez un compte passkey avec le sponsoring désactivé.
3. Financez ou déployez le compte passkey si votre test l'exige.
4. Construisez un lot ERC-20 approve plus `transferFrom`.
5. Envoyez le lot avec `wallet_sendCalls`.
6. Confirmez que le portefeuille affiche les calldata décodées et une seule approbation WebAuthn pour le lot passkey.
