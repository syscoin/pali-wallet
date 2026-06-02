---
title: Batched execution
---

Passkey smart account는 `wallet_sendCalls`를 통한 batched execution을 지원합니다. 이를 통해 사용자는 하나의 wallet review와 하나의 WebAuthn assertion으로 여러 call을 승인할 수 있습니다.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="decoded calldata가 포함된 Pali wallet_sendCalls passkey batch review" />
</a>
  <figcaption>Pali는 하나의 WebAuthn approval 전에 전체 passkey batch를 review하고 일반 token call을 decode합니다.</figcaption>
</figure>

## 예시: approve 및 transferFrom

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

`atomicRequired`가 true이면 사용자는 전체 batch를 승인하거나 거절해야 합니다. Pali의 passkey path는 선택된 모든 call을 하나의 smart account execution으로 준비합니다. business logic이 all-or-nothing behavior를 요구할 때 dapp은 사용자에게 partial batch approval을 요청해서는 안 됩니다.

## Sponsor proof capability

sponsored passkey execution의 경우 해당될 때 dapp은 capability를 통해 batch-level sponsor proof를 전달할 수 있습니다. Pali는 저장된 account sponsor metadata를 통한 sponsor service resolution도 지원합니다.

## 지원되지 않는 call type

Passkey `wallet_sendCalls`는 empty target transaction으로 표현된 contract deployment call을 지원하지 않습니다. contract는 별도로 deploy하거나 target contract call을 사용하세요.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Passkey wallet_sendCalls batch flow"></video>
  <figcaption>Passkey batch execution flow: branded intro, decoded call, 하나의 passkey approval, transaction result.</figcaption>
</figure>
