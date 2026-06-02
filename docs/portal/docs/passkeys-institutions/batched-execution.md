---
title: Batched execution
---

Passkey smart accounts support batched execution through `wallet_sendCalls`. This lets the user approve multiple calls with one wallet review and one WebAuthn assertion.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="Pali wallet_sendCalls passkey batch review with decoded calldata" />
</a>
  <figcaption>Pali reviews the full passkey batch and decodes common token calls before one WebAuthn approval.</figcaption>
</figure>

## Example: approve and transferFrom

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
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## Atomic UX

When `atomicRequired` is true, the user should approve or reject the full batch. Pali's passkey path prepares all selected calls as a single smart account execution. Dapps should not ask users to approve partial batches when the business logic requires all-or-nothing behavior.

## Sponsor proof capability

For sponsored passkey execution, a dapp may pass a batch-level sponsor proof through capabilities when applicable. Pali also supports sponsor service resolution through stored account sponsor metadata.

## Unsupported call type

Passkey `wallet_sendCalls` does not support contract deployment calls expressed as empty target transactions. Deploy contracts separately or use a target contract call.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Passkey wallet_sendCalls batch flow"></video>
  <figcaption>Passkey batch execution flow: branded intro, decoded calls, one passkey approval, transaction result.</figcaption>
</figure>
