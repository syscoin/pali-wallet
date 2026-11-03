---
title: wallet_sendCalls
---

Pali는 EVM 배치 요청에 EIP-5792 방식의 `wallet_sendCalls`를 지원합니다. 지원되는 Pali 스마트 계정은 여러 호출을 하나의 계정 실행으로 승인할 수 있습니다.

## Capability 확인

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali는 지원되는 Pali 스마트 계정에는 원자적 실행 지원을, 일반 EOA에는 원자적 실행 미지원을 보고합니다.

## Batch 전송

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

## 스마트 계정 동작

사용자는 요청된 전체 배치를 승인하거나 거부하며 개별 호출을 선택 해제할 수 없습니다. Pali 스마트 계정은 전체 배치를 하나의 계정 실행으로 준비하고 활성 검증자의 승인을 요청하며 지갑 차단 목록으로 대상을 확인한 뒤 트랜잭션 하나를 제출합니다. 패스키 검증자는 WebAuthn assertion을 사용하고 구성된 로컬 ECDSA 소유자는 액션 해시에 서명합니다.

## EOA 동작

일반 EVM 계정에서는 Pali가 전체 요청 배치를 승인 또는 거부하도록 표시하고 호출을 순차적으로 전송합니다. 이는 온체인 원자적 실행이 아닙니다. 원자성이 필요한 dapp은 지원되는 Pali 스마트 계정 또는 원자적 배치용 컨트랙트를 사용해야 합니다.

## Status method

`wallet_getCallsStatus`와 `wallet_showCallsStatus`는 EIP-5792에 따라 구현되어 있습니다. `wallet_getCallsStatus`는 온체인 receipts가 포함된 표준 status 객체(`100` 대기 중, `200` 확정, `500` 리버트, `600` 부분 리버트)를 반환하며, `wallet_showCallsStatus`는 동일한 정보를 보여주는 읽기 전용 Pali 팝업을 엽니다. `wallet_sendCalls`에서 dapp이 제공한 `id`는 존중되어 그대로 반환됩니다. 알 수 없는 bundle id는 오류 `5730`으로, 중복된 dapp 제공 id는 `5720`으로 실패합니다.
