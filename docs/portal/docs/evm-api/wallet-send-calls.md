---
title: wallet_sendCalls
---

Pali supports EIP-5792-style `wallet_sendCalls` for EVM batch requests. A supported Pali smart account can authorize multiple calls as one account execution.

## Check capabilities

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali reports atomic support for supported Pali smart accounts and unsupported atomic execution for regular EOAs.

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

The user approves or rejects the entire requested batch; individual calls cannot be deselected. For Pali smart accounts, Pali prepares the complete batch as one account execution, requests authorization from the active validator, checks targets against the wallet blacklist, and submits one transaction. A passkey validator uses a WebAuthn assertion; configured local ECDSA owners sign the action hash.

## EOA behavior

For regular EVM accounts, Pali presents the entire requested batch for approval or rejection and sends its calls sequentially. This is not on-chain atomic execution. If a dapp requires atomic execution, use a supported Pali smart account or a contract designed for atomic batching.

## Status methods

`wallet_getCallsStatus` and `wallet_showCallsStatus` are implemented per EIP-5792. `wallet_getCallsStatus` returns the standard status object (`100` pending, `200` confirmed, `500` reverted, `600` partially reverted) with on-chain receipts; `wallet_showCallsStatus` opens a read-only Pali popup with the same information. Dapp-provided `id`s in `wallet_sendCalls` are honored and returned. Unknown bundle ids fail with error `5730`; duplicate dapp-provided ids fail with `5720`.
