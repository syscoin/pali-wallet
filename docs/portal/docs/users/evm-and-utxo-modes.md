---
title: EVM and UTXO modes
---

Pali supports account-based EVM networks and UTXO-based networks. The extension uses separate provider surfaces because the account models are fundamentally different.

## EVM mode

EVM mode is for dapps that use `window.ethereum`. It supports MetaMask-style account requests, transactions, signatures, permissions, token watch requests, and network management.

Examples:

- Rollux and Syscoin NEVM dapps
- ERC-20, ERC-721, and ERC-1155 interactions
- EIP-712 typed data signing
- smart-account creation and execution

## UTXO mode

UTXO mode is for dapps that use `window.pali`. It supports Syscoin UTXO account state, xpub-aware integrations, PSBT signing, transaction broadcast, and SPT asset flows.

Examples:

- Syscoin UTXO asset applications
- Bitcoin-like PSBT workflows
- dapps that need a change address
- dapps that read UTXO transaction history

## Switching modes

If a dapp requests a method for the wrong chain family, Pali may require a network switch. Dapps should handle these errors cleanly and guide users to the right network.

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

Switching between UTXO and EVM contexts can require reconnecting the dapp because the active account family changes.
