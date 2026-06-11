---
title: 오류
---

provider request는 항상 `try` / `catch`로 감싸세요. Pali는 가능한 경우 표준 JSON-RPC 및 EIP-1193 style error를 사용하고, unsupported network, hardware wallet restriction, passkey state에 대해서는 wallet-specific error를 추가로 사용합니다.

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

## 일반적인 범주

| Code | 의미 |
| --- | --- |
| `4001` | 사용자가 요청을 거절했습니다. |
| `4100` | 승인되지 않은 account 또는 method입니다. |
| `4101` | method는 다른 chain family에서만 사용할 수 있습니다. |
| `4200` | 지원되지 않는 method입니다. |
| `4900` | Provider가 disconnected 상태입니다. |
| `4901` | Provider가 요청된 chain에서 disconnected 상태입니다. |
| `5710` | EIP-5792 bundle의 체인에 대한 RPC가 지갑에 설정되어 있지 않습니다 (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | `wallet_sendCalls`에서 dapp이 제공한 EIP-5792 bundle id가 중복되었습니다. |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus`의 알 수 없는 EIP-5792 bundle id입니다. |

더 긴 reference는 [Error codes](../reference/error-codes.md)를 참조하세요.
