---
title: 오류
---

공급자 요청은 항상 `try` / `catch`로 감싸세요. Pali는 가능한 경우 표준 JSON-RPC 및 EIP-1193 방식의 오류를 사용하며, 지원되지 않는 네트워크, 하드웨어 지갑 제한, 패스키 상태에는 지갑별 오류도 사용합니다.

```js
try {
  await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx],
  });
} catch (error) {
  switch (error.code) {
    case 4001:
      console.log('User rejected the request.');
      break;
    case 4100:
      console.log('The dapp is not authorized.');
      break;
    case 4200:
      console.log('The method is unsupported.');
      break;
    default:
      console.error(error);
  }
}
```

## 일반적인 분류

| 코드 | 의미 |
| --- | --- |
| `4001` | 사용자가 요청을 거부했습니다. |
| `4100` | 계정 또는 메서드에 권한이 없습니다. |
| `4101` | 다른 체인 계열에서만 사용할 수 있는 메서드입니다. |
| `4200` | 지원하지 않는 메서드입니다. |
| `4900` | 공급자의 연결이 끊어졌습니다. |
| `4901` | 공급자가 요청한 체인과 연결되어 있지 않습니다. |
| `5710` | 지갑에 EIP-5792 번들의 체인용 RPC가 설정되어 있지 않습니다(`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | `wallet_sendCalls`에서 dapp이 제공한 EIP-5792 번들 id가 중복되었습니다. |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus`의 EIP-5792 번들 id를 찾을 수 없습니다. |

자세한 내용은 [오류 코드](../reference/error-codes.md)를 참고하세요.

## 중단된 요청 재시도

시간 초과, 승인 창 닫힘 또는 연결 끊김이 발생했다고 트랜잭션이 제출되지 않았다고 단정할 수는 없습니다. 서명이나 제출을 다시 요청하기 전에 알려진 트랜잭션 해시, 거래 내역 또는 번들 상태를 확인하세요. 전파가 확인되었다면, 이후 로컬 내역 업데이트가 실패해도 전파 자체는 성공한 것입니다.

일반적인 조회는 적절한 경우 다시 시도할 수 있지만, 결과가 불확실한 상태에서 서명, 지갑 생성 또는 전파 요청을 자동으로 재실행하지 마세요. 계정이나 네트워크가 바뀌었다면 현재 컨텍스트에 맞는 새 승인을 받으세요. 스마트 계정 설정이 대기 중이면 다시 배포하기 전에 원래 네트워크에서 상태를 확인하세요.
