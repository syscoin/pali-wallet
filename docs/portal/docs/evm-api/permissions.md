---
title: Permissions
---

Pali supports EIP-2255-style permissions for EVM dapps.

## Request permissions

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

Most dapps can use `eth_requestAccounts` instead. Use `wallet_requestPermissions` when you want explicit permission objects and permitted-chain metadata.

## Get permissions

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## Revoke permissions

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

In Pali, revocation disconnects the dapp from the wallet. Treat this as a full site disconnect rather than granular partial permission editing.

## Account switching

For blocking methods such as transaction sending and signing, Pali checks that the connected dapp account matches the account requested by the dapp. If the dapp sends a `from` address that is not the active connected account, Pali may prompt the user to switch the dapp connection.
