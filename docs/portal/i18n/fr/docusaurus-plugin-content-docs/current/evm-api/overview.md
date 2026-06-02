---
title: Vue d'ensemble de l'API EVM
---

Le provider EVM de Pali est exposé via `window.ethereum` et est compatible avec les intégrations de dapps standard de style MetaMask.

## Méthodes courantes

| Domaine | Méthodes |
| --- | --- |
| Connexion | `eth_requestAccounts`, `eth_accounts` |
| Réseau | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| Transactions | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| Signature | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Permissions | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Actifs | `wallet_watchAsset` |
| Lots | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkeys | `wallet_createPasskeyAccount` |

## Forme d'une requête de provider

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## Relais RPC en lecture seule

Pali transmet de nombreuses méthodes Ethereum JSON-RPC en lecture seule au provider RPC actif, y compris les requêtes de blocs, transactions, reçus, logs, frais, soldes, code, stockage et preuves.

## Subscriptions non prises en charge

`eth_subscribe` et `eth_unsubscribe` ne sont pas pris en charge par le provider intégré au portefeuille. Utilisez votre propre provider RPC WebSocket pour un état applicatif qui dépend fortement des subscriptions.
