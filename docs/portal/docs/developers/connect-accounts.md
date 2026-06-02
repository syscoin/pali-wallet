---
title: Connect accounts
---

Pali connection requests are explicit user approvals. Dapps should request access only when the user clicks a connect button.

## EVM connect

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXO connect

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Read connection state

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## One active account per dapp

Pali can keep many dapp origins connected. For a single origin, Pali tracks one active connected account. If a sensitive request references a different `from` address, Pali may ask the user to switch the dapp connection.

## Disconnecting

For EVM permissions, `wallet_revokePermissions` disconnects the dapp from Pali.

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
