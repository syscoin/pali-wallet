---
title: EIPs et compatibilité
---

Pali vise à prendre en charge les standards de portefeuille que les vraies dapps utilisent, tout en ajoutant des capacités UTXO et passkey.

## Standards de portefeuille EVM

| Standard | Prise en charge par Pali |
| --- | --- |
| EIP-1193 | Requêtes/événements/erreurs de provider via `window.ethereum`. |
| EIP-6963 | Découverte multi-portefeuille et annonce du provider. |
| EIP-1102 | `enable()` est déprécié au profit des méthodes de demande de compte. |
| EIP-1474 | Codes d'erreur de style JSON-RPC pour Ethereum RPC. |
| EIP-2255 | Méthodes de permissions de portefeuille. |
| EIP-3085 | `wallet_addEthereumChain`. |
| EIP-3326 | `wallet_switchEthereumChain`. |
| EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities`, méthodes de compatibilité d'état. |
| EIP-712 | Signature de données typées via `eth_signTypedData_v4` et méthodes associées. |
| EIP-747 | `wallet_watchAsset`. |

## Compatibilité MetaMask

Pali expose `window.ethereum` pour les dapps qui s'attendent à un comportement de style MetaMask. Il marque aussi le provider comme compatible MetaMask pour les intégrations héritées et s'annonce via EIP-6963 pour la sélection moderne de portefeuille.

## Extensions Pali au-delà d'EVM

Pali ajoute `window.pali` pour les flux UTXO/Syscoin. Ces méthodes ne sont pas des EIPs Ethereum ; elles constituent l'API de portefeuille de navigateur de Pali pour l'état de compte UTXO, la signature PSBT, les actifs Syscoin et les flux de dapp de style Bitcoin.

## Réserves de compatibilité

- Les subscriptions EVM ne sont pas prises en charge par le provider de l'extension.
- `wallet_getCallsStatus` et `wallet_showCallsStatus` sont des stubs de compatibilité.
- L'exécution `wallet_sendCalls` EOA est séquentielle, pas une véritable atomicité on-chain.
- Les familles de réseaux UTXO et EVM sont séparées par la surface de provider et l'état du portefeuille.
