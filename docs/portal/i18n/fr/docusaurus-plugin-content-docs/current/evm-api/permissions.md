---
title: Permissions
---

Pali prend en charge les permissions de style EIP-2255 pour les dapps EVM.

## Demander des permissions

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

La plupart des dapps peuvent utiliser `eth_requestAccounts` à la place. Utilisez `wallet_requestPermissions` lorsque vous voulez des objets de permission explicites et des métadonnées de chaînes autorisées.

## Obtenir les permissions

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## Révoquer les permissions

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

Dans Pali, la révocation déconnecte la dapp du portefeuille. Traitez cela comme une déconnexion complète du site plutôt que comme une édition partielle et granulaire des permissions.

## Changement de compte

Pour les méthodes bloquantes comme l'envoi de transactions et la signature, Pali vérifie que le compte de dapp connecté correspond au compte demandé par la dapp. Si la dapp envoie une adresse `from` qui n'est pas le compte connecté actif, Pali peut demander à l'utilisateur de changer la connexion de la dapp.
