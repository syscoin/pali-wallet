---
title: EVM API overview
---

Pali's EVM provider is exposed through `window.ethereum` and is compatible with standard MetaMask-style dapp integrations.

## Common methods

| Area | Methods |
| --- | --- |
| Connect | `eth_requestAccounts`, `eth_accounts` |
| Network | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| Transactions | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| Signing | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Permissions | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Assets | `wallet_watchAsset` |
| Batches | `wallet_sendCalls`, `wallet_getCapabilities` |
| Smart accounts | `wallet_prepareSmartAccount` |

## Provider request shape

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## Read-only RPC proxying

Pali forwards many read-only Ethereum JSON-RPC methods to the active RPC provider, including block, transaction, receipt, log, fee, balance, code, storage, and proof queries.

## Unsupported subscriptions

`eth_subscribe` and `eth_unsubscribe` are not supported by the in-wallet provider. Use your own WebSocket RPC provider for subscription-heavy application state.
