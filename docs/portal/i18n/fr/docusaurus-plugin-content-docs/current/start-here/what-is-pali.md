---
title: Qu'est-ce que Pali ?
---

Pali Wallet est l'extension de portefeuille officielle de Syscoin et un portefeuille web3 généraliste pour les chaînes compatibles EVM. Il est conçu pour trois publics qui se recoupent :

- **Utilisateurs réguliers** qui veulent un portefeuille de navigateur sécurisé pour les actifs EVM, Syscoin, Rollux et UTXO.
- **Développeurs de dapps** qui veulent un accès EVM compatible MetaMask et un accès UTXO depuis la même extension.
- **Institutions** qui veulent des comptes intelligents passkey, la récupération de compte, une politique de sponsor et une intégration pilotée par dapp.

## Ce qui différencie Pali

La plupart des portefeuilles de navigateur n'exposent qu'un provider EVM. Pali expose deux surfaces complémentaires :

- `window.ethereum` pour les dapps EVM, volontairement compatible avec les flux MetaMask courants.
- `window.pali` pour les flux Syscoin UTXO et de style Bitcoin.

Cela permet à une dapp de construire des expériences qui traversent des chaînes basées sur des comptes et des chaînes basées sur UTXO sans demander aux utilisateurs d'installer différents portefeuilles.

## Compatibilité en un coup d'oeil

| Capacité | Surface prise en charge |
| --- | --- |
| Requêtes de provider EIP-1193 | `window.ethereum` |
| Découverte de portefeuille EIP-6963 | Annonce du provider `window.ethereum` |
| Permissions de compte | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Transactions et signatures EVM | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, méthodes de signature associées |
| Requêtes groupées EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities` |
| État de compte UTXO et xpub | `window.pali` et méthodes `sys_*` |
| Signature PSBT et diffusion | `sys_sign`, `sys_signAndSend` |
| Création de compte intelligent passkey | `wallet_createPasskeyAccount` |

## Portée actuelle des passkeys

Les comptes intelligents passkey ne sont disponibles que sur les réseaux EVM de la famille zkSYS où Pali a configuré les contrats de factory passkey et où la chaîne prend en charge la vérification des preuves P-256 WebAuthn. Cette version de Pali configure le testnet `zkTanenbaum` (`57057`). La prise en charge de zkSYS en production utilise la même architecture une fois que l'adresse de factory de production est configurée dans Pali. Les dapps doivent vérifier les capacités et gérer proprement les chaînes non prises en charge.
