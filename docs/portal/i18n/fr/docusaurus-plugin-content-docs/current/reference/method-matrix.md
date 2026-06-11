---
title: Matrice des méthodes
---

Cette référence résume les méthodes publiques exposées aux dapps, documentées à partir du registre de méthodes et des providers actuels de Pali.

## Méthodes de portefeuille

| Méthode | Surface | Objectif | Popup |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | Lire l'état de verrouillage. | Non |
| `wallet_isConnected` | EVM / UTXO | Lire l'état de connexion du site. | Non |
| `wallet_getAccount` | EVM / UTXO | Lire l'objet de compte connecté. | Non |
| `wallet_getAddress` | EVM / UTXO | Lire l'adresse connectée. | Non |
| `wallet_getPublicKey` | EVM / UTXO | Lire la clé publique. | Non |
| `wallet_getBalance` | EVM / UTXO | Lire le solde. | Non |
| `wallet_getChangeAddress` | UTXO | Lire l'adresse de rendu de monnaie. | Non |
| `wallet_getNetwork` | EVM / UTXO | Lire le réseau actif. | Non |
| `wallet_getTokens` | EVM / UTXO | Lire les avoirs en jetons. | Non |
| `wallet_estimateFee` | EVM / UTXO | Estimer les frais. | Non |
| `wallet_getProviderState` | EVM | Initialiser l'état du provider EVM. | Non |
| `wallet_getSysProviderState` | UTXO | Initialiser l'état du provider UTXO. | Non |
| `wallet_getSysAssetMetadata` | UTXO | Lire les métadonnées d'actif Syscoin. | Non |
| `wallet_changeAccount` | EVM / UTXO | Changer le compte connecté. | Oui |
| `wallet_requestPermissions` | EVM | Demander des permissions EIP-2255. | Oui |
| `wallet_getPermissions` | EVM | Lire les permissions EIP-2255. | Non |
| `wallet_revokePermissions` | EVM | Révoquer les permissions et déconnecter. | Non |
| `wallet_watchAsset` | EVM | Demander le suivi d'un actif. | Oui |
| `wallet_addEthereumChain` | EVM | Ajouter une chaîne EVM. | Oui |
| `wallet_switchEthereumChain` | EVM | Changer de chaîne EVM. | Oui |
| `wallet_prepareSmartAccount` | EVM | Créer et déployer un compte intelligent passkey. | Oui |
| `wallet_sendCalls` | EVM | Envoyer une requête groupée EIP-5792. | Oui |
| `wallet_getCapabilities` | EVM | Lire les capacités du compte. | Non |
| `wallet_getCallsStatus` | EVM | Résout un batch envoyé en statut EIP-5792 + receipts. | Non |
| `wallet_showCallsStatus` | EVM | Affiche le statut du batch dans un popup du wallet. | Oui |

## Méthodes EVM

| Groupe de méthodes | Méthodes |
| --- | --- |
| Comptes | `eth_requestAccounts`, `eth_accounts` |
| Transactions | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| Signature | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Réseau | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| Données de chaîne | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, méthodes de recherche de blocs et transactions |
| Données de noeud | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## Méthodes UTXO et Syscoin

| Méthode | Objectif |
| --- | --- |
| `sys_requestAccounts` | Connecter un compte UTXO. |
| `sys_getAccount` | Lire les détails du compte. |
| `sys_isConnected` | Lire l'état de connexion. |
| `sys_getNetwork` | Lire le réseau UTXO. |
| `sys_getPublicKey` | Lire la clé publique. |
| `sys_getCurrentAddressPubkey` | Lire la pubkey de l'adresse courante. |
| `sys_getBip32Path` | Lire le chemin de dérivation. |
| `sys_getChangeAddress` | Lire l'adresse de rendu de monnaie. |
| `sys_getTransactions` | Lire les transactions. |
| `sys_transaction` | Lire une transaction. |
| `sys_sign` | Signer un PSBT. |
| `sys_signAndSend` | Signer et diffuser. |
| `sys_isValidSYSAddress` | Valider une adresse Syscoin. |
| `sys_changeUTXOEVM` | Changer de famille de chaînes. |
| `sys_switchChain` | Changer de chaîne UTXO. |

## Assistants `_sys`

| Assistant | Objectif |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | Lire les jetons Syscoin mintés par l'utilisateur. |
| `window.pali._sys.getHoldingsData()` | Lire les avoirs en jetons. |
| `window.pali._sys.getConnectedAccountXpub()` | Lire le xpub connecté. |
| `window.pali._sys.getChangeAddress()` | Lire une adresse de rendu de monnaie. |
| `window.pali._sys.getDataAsset(assetGuid)` | Lire un actif de données Syscoin. |
