---
title: Connecter des comptes
---

Les demandes de connexion Pali sont des approbations utilisateur explicites. Les dapps doivent demander l'accès uniquement lorsque l'utilisateur clique sur un bouton de connexion.

## Connexion EVM

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Connexion UTXO

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Lire l'état de connexion

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## Un compte actif par dapp

Pali peut garder de nombreuses origines de dapp connectées. Pour une seule origine, Pali suit un seul compte connecté actif. Si une requête sensible référence une adresse `from` différente, Pali peut demander à l'utilisateur de changer la connexion de la dapp.

## Déconnexion

Pour les permissions EVM, `wallet_revokePermissions` déconnecte la dapp de Pali.

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
