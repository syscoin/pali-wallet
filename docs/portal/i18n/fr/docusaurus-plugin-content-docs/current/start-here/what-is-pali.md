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
| Création de compte intelligent passkey | `wallet_prepareSmartAccount` |

## Portée actuelle des passkeys

Les comptes intelligents Pali sont disponibles sur les réseaux EVM où la factory et les modules Pali existent aux adresses utilisées par Pali. Cette version de Pali configure le testnet `zkTanenbaum` (`57057`), et la prise en charge de zkSYS en production utilise la même architecture une fois les adresses de production configurées.

L'infrastructure n'est pas limitée aux chaînes opérées par Pali. Sur les réseaux EVM compatibles avec le support CREATE2 canonique, Pali peut déployer la configuration de compte intelligent requise directement depuis le portefeuille : ouvrez Pali Settings, allez dans Advanced, puis utilisez le bouton Deploy dans **Smart account setup**. Les validateurs passkey ont besoin de la vérification P-256 WebAuthn, souvent fournie par un precompile P-256/passkey.
