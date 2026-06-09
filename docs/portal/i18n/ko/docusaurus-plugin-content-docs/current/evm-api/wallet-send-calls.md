---
title: wallet_sendCalls
---

Pali는 EVM batch request용 EIP-5792-style `wallet_sendCalls`를 지원합니다. 이는 여러 call을 하나의 WebAuthn assertion으로 승인할 수 있는 Pali smart account에서 특히 중요합니다.

## Capability 확인

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali는 Pali smart account에 대해 atomic support를 보고하고, 일반 EOA에 대해서는 unsupported atomic execution을 보고합니다.

## Batch 전송

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

## Passkey 동작

Pali smart account의 경우 Pali는 선택된 모든 call을 하나의 smart account execution batch로 준비하고, 하나의 passkey assertion을 요청한 뒤, 하나의 transaction을 제출합니다. Local smart account는 confirmed on-chain deployment를 나타냅니다.

## EOA 동작

일반 EVM account의 경우 Pali는 call을 표시하고 선택된 call을 순차적으로 보냅니다. 이는 on-chain atomicity와 같지 않습니다. dapp에 진정한 atomic execution이 필요하다면 Pali smart account 또는 call을 atomically batch하도록 설계된 contract를 사용하세요.

## Status method

`wallet_getCallsStatus`와 `wallet_showCallsStatus`는 compatibility를 위해 존재하지만 persistent bundle status는 구현되어 있지 않습니다. 즉시 반환되는 `wallet_sendCalls` result와 transaction hash를 유용한 output으로 취급하세요.
