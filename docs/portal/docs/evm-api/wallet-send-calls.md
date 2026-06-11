---
title: wallet_sendCalls
---

Pali supports EIP-5792-style `wallet_sendCalls` for EVM batch requests. This is especially important for smart accounts, where multiple calls can be authorized as one account execution.

## Check capabilities

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali reports atomic support for Pali smart accounts and unsupported atomic execution for regular EOAs.

## Send a batch

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
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

## Smart-account behavior

For Pali smart accounts, Pali prepares all selected calls as one account execution batch, requests authorization from the active validator, checks targets against the wallet blacklist, and submits one transaction. If the active validator is passkey-based, the authorization is a WebAuthn assertion. If it is ECDSA-based, configured local owners sign the action hash.

## EOA behavior

For regular EVM accounts, Pali presents the calls and sends selected calls sequentially. That is not the same as on-chain atomicity. If a dapp requires true atomic execution, use a Pali smart account or a contract designed to batch calls atomically.

## Status methods

`wallet_getCallsStatus` and `wallet_showCallsStatus` are implemented per EIP-5792. `wallet_getCallsStatus` returns the standard status object (`100` pending, `200` confirmed, `500` reverted, `600` partially reverted) with on-chain receipts; `wallet_showCallsStatus` opens a read-only Pali popup with the same information. Dapp-provided `id`s in `wallet_sendCalls` are honored and returned. Unknown bundle ids fail with error `5730`; duplicate dapp-provided ids fail with `5720`.
