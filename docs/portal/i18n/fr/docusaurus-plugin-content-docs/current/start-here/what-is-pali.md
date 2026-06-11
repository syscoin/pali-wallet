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

## Nouveautés de Pali v4

Pali v4 est une modernisation en profondeur du portefeuille autour de trois idées : la vitesse, les standards et une autorité de signature flexible.

- **Plus rapide partout.** Pali regroupe le trafic RPC sur les réseaux EVM et UTXO, de sorte que les soldes, l'historique et les données de frais se chargent en bien moins d'allers-retours. Le résultat est un portefeuille qui paraît instantané plutôt qu'occupé à charger.
- **Des comptes intelligents fondés sur des standards.** Les comptes intelligents Pali suivent le modèle de modules ERC-7579 avec un encodage d'exécution de style ERC-4337. Rien dans le compte n'est un verrouillage propriétaire : les validateurs, les exécuteurs et le comportement du compte suivent des spécifications publiques.
- **L'autorisation est séparée du compte.** Qui peut signer est une décision de module, pas une propriété gravée dans l'adresse. Aujourd'hui, cela signifie des clés ECDSA détenues par le portefeuille et des passkeys P-256 WebAuthn. Demain, cela peut signifier de nouveaux types de validateurs — y compris des schémas de signature post-quantiques — installés sur le même compte à la même adresse, sans aucun ECDSA impliqué dans l'autorisation de chaque transaction.
- **Des politiques de signature composables.** Un validateur composite combine des validateurs enfants sous un seuil : 1-of-N pour la commodité, t-of-N pour le contrôle partagé, N-of-N pour une assurance maximale. Les composites peuvent s'imbriquer, donc les politiques peuvent être hiérarchiques.
- **Les gardiens protègent contre la perte d'accès.** La récupération par gardiens est un module distinct de rôle exécuteur (selon ERC-7579), délibérément séparé des validateurs. Les gardiens ne peuvent pas signer de transactions ; ils peuvent seulement programmer un remplacement de validateur soumis à un délai. Ajoutez ou retirez des gardiens à tout moment tant que le compte est sain.

## Où va Pali

La direction de Pali est **une autorité de signature dynamique et flexible pour les frontends crypto**. N'importe quel frontend — une dapp, un exchange, un tableau de bord institutionnel, un service intégré — devrait pouvoir demander au portefeuille exactement la politique de signature dont la tâche a besoin : un passkey pour un onboarding sans effort, un composite t-of-N pour une trésorerie partagée, un gardien adossé à du matériel pour la récupération, ou un futur type de validateur qui n'existe pas encore. L'adresse du compte reste stable tandis que l'autorité derrière elle évolue.

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
