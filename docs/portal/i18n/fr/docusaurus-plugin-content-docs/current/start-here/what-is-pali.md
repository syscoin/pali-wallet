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

## Qu'est-ce qui rend Pali différente ?

Pali repose sur une idée : le portefeuille doit être la frontière de sécurité de l'utilisateur, pas un serveur. Pali peut lire depuis des nœuds RPC, des explorateurs et des indexeurs comme tout portefeuille de navigateur, mais la garde, les approbations, la récupération et la politique du compte restent avec les clés de l'utilisateur et les modules on-chain.

- **Pas de serveur de garde ou de récupération.** Pali ne conserve pas de clé côté serveur, de données chiffrées dans le cloud, de moteur de politique ou de porte dérobée de récupération. Les actions sensibles sont approuvées dans l'extension, signées par le portefeuille, le passkey, l'appareil matériel ou le validateur de compte intelligent de l'utilisateur, puis appliquées par la chain.
- **Lectures rapides avec fallbacks robustes.** Quand Pali doit effectuer de nombreuses lectures de contrats EVM, il essaie d'abord Multicall3 `aggregate3` : un `eth_call` on-chain, une vue sur le même bloc et une isolation des échecs par appel. Si Multicall3 n'est pas déployé ou si le RPC le refuse, Pali bascule vers le batch JSON-RPC ; si le batch n'est pas disponible, il revient aux appels individuels.
- **Deux familles de chains dans un seul portefeuille.** Pali expose `window.ethereum`, compatible MetaMask, pour les dapps EVM et `window.pali` pour les flux Syscoin UTXO / style Bitcoin. Une dapp peut travailler avec des actifs basés sur comptes, des UTXO, des PSBT et des xpubs depuis une seule extension.
- **Comptes classiques et comptes intelligents.** Les utilisateurs peuvent garder côte à côte des comptes de type EOA, des comptes de hardware wallet et des comptes intelligents Pali. Les comptes classiques sont simples et portables. Les comptes intelligents ajoutent une politique programmable : passkeys, validateurs ECDSA détenus par le portefeuille, politiques de seuil composite, récupération par gardiens et modules personnalisés.
- **Intégration dapp axée sur les standards.** Pali suit les APIs de portefeuille que les dapps utilisent déjà : EIP-1193, EIP-6963, permissions EIP-2255, EIP-5792 `wallet_sendCalls`, données typées EIP-712 et comportement de requêtes compatible MetaMask. Les comptes intelligents Pali utilisent des modules validateur/exécuteur de style ERC-7579 et des données d'exécution de style ERC-4337.
- **Autorisation programmable.** Dans un compte intelligent Pali, l'adresse reste stable mais la politique de signature peut évoluer. Un validateur décide qui peut approuver les actions ; un exécuteur ajoute des fonctions comme la récupération par gardiens. Une équipe peut donc passer d'un passkey à une politique à seuil, ajouter une récupération ou adopter de nouveaux types de validateurs sans déplacer les fonds.
- **Pensé pour des signatures futures plus fortes.** Comme l'autorisation est modulaire, de futurs validateurs peuvent prendre en charge des schémas au-delà d'ECDSA et des passkeys P-256, y compris des signatures post-quantiques lorsqu'elles seront pratiques pour la chain cible.
- **La sécurité avant la commodité.** Pali sérialise les approbations bloquantes, vérifie les sites connectés et le contexte réseau, bloque les alertes blacklist à haut risque pour les envois et approvals, et garde la récupération par gardiens séparée de la signature des transactions. Les gardiens peuvent aider à récupérer l'accès après un délai ; ils ne peuvent pas dépenser les fonds en silence.

La direction de Pali est **des comptes programmables en auto-garde pour de vrais utilisateurs et de vraies dapps** : assez rapides pour l'usage quotidien, assez standards pour les développeurs, assez flexibles pour les institutions et assez conservateurs pour que le contrôle critique reste avec l'utilisateur et la chain.

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
