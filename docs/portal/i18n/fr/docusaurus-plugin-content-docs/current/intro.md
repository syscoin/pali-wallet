---
title: Bienvenue dans Pali Wallet
slug: /
---

Pali Wallet est un portefeuille sous forme d'extension de navigateur pour les personnes et les applications qui ont besoin d'un accès blockchain à la fois basé sur des comptes et basé sur UTXO depuis une même couche de sécurité.

Pour les dapps EVM, Pali expose un provider `window.ethereum` compatible avec MetaMask, avec des requêtes EIP-1193, la découverte EIP-6963, les permissions de compte, le changement de chaîne, les signatures, les transactions et les appels groupés. Pour les applications Syscoin UTXO et de style Bitcoin, Pali expose `window.pali` avec des méthodes de compte, xpub, adresse de rendu de monnaie, signature PSBT, transaction et actifs.

Pali prend aussi en charge les comptes intelligents passkey pour les institutions et les dapps avancées. Une dapp peut demander à Pali de créer et de déployer un compte intelligent adossé à WebAuthn, d'attacher une politique de sponsor pendant la création, puis d'exécuter plus tard des lots atomiques via `wallet_sendCalls`. La récupération des comptes passkey existants est gérée dans Pali.

Pali v4 reconstruit le portefeuille autour de la vitesse et d'une autorité de signature flexible : des appels RPC groupés sur les réseaux EVM et UTXO pour une interface nettement plus rapide, des comptes intelligents qui suivent les standards ERC-7579 / ERC-4337, et un modèle d'autorisation modulaire où les validateurs (qui peuvent signer) et les gardiens (qui peuvent récupérer) sont des rôles indépendants et évolutifs sur la même adresse de compte stable. Consultez [Qu'est-ce que Pali ?](./start-here/what-is-pali.md) pour une vue d'ensemble.

## Choisissez votre parcours

- **Utilisateurs** : commencez par [Bien démarrer](./users/getting-started.md).
- **Développeurs EVM** : commencez par [Découverte du provider](./developers/provider-discovery.md) et [Vue d'ensemble de l'API EVM](./evm-api/overview.md).
- **Développeurs UTXO et Syscoin** : commencez par [Vue d'ensemble de l'API UTXO et Syscoin](./utxo-syscoin-api/overview.md).
- **Institutions utilisant des passkeys** : commencez par [Passkeys et institutions](./passkeys-institutions/overview.md).

## Surfaces de provider

| Provider | Famille de chaîne | Usage principal |
| --- | --- | --- |
| `window.ethereum` | EVM | Intégrations de dapps compatibles MetaMask, signatures, transactions, permissions et lots EIP-5792. |
| `window.pali` | UTXO / Syscoin | Comptes Syscoin UTXO, signature PSBT, flux xpub/adresse de rendu de monnaie et assistants d'actifs. |

## Modèle de sécurité important

Pali est volontairement conservateur. Les dapps se connectent par hôte, les validations bloquantes sont sérialisées, les incompatibilités de type de réseau sont traitées explicitement et les utilisateurs approuvent les actions sensibles dans l'interface de l'extension. De nombreux sites peuvent être connectés, mais chaque site n'a qu'un seul compte connecté actif à la fois.
