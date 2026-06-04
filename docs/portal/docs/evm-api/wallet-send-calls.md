---
title: wallet_sendCalls
---

Pali supports EIP-5792-style `wallet_sendCalls` for EVM batch requests. This is especially important for passkey smart accounts, where multiple calls can be authorized with a single WebAuthn assertion.

## Check capabilities

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali reports atomic support for passkey smart accounts and unsupported atomic execution for regular EOAs.

## Send a batch

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## Passkey behavior

For passkey smart accounts, Pali prepares all selected calls as one smart account execution batch, requests one passkey assertion, and submits one transaction. The passkey account must already be deployed; Pali's create flow confirms deployment before the account can be used locally.

## EOA behavior

For regular EVM accounts, Pali presents the calls and sends selected calls sequentially. That is not the same as on-chain atomicity. If a dapp requires true atomic execution, use a passkey smart account or a contract designed to batch calls atomically.

## Status methods

`wallet_getCallsStatus` and `wallet_showCallsStatus` are present for compatibility, but persistent bundle status is not implemented. Treat the immediate `wallet_sendCalls` result and transaction hash as the useful output.
