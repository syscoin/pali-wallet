---
title: Error code
---

Pali는 JSON-RPC, EIP-1193, EIP-1474, wallet-specific error를 사용합니다. dapp은 항상 `error.code`와 `error.message`를 모두 검사해야 합니다.

## Standard JSON-RPC

| Code | 의미 |
| --- | --- |
| `-32700` | Parse error. |
| `-32600` | Invalid request. |
| `-32601` | Method not found 또는 unavailable. |
| `-32602` | Invalid params. |
| `-32603` | Internal error. |

## Ethereum provider error

| Code | 의미 |
| --- | --- |
| `4001` | 사용자가 요청을 거절했습니다. |
| `4100` | 승인되지 않은 account 또는 method입니다. |
| `4200` | 지원되지 않는 method입니다. |
| `4900` | Provider가 disconnected 상태입니다. |
| `4901` | Provider가 지정된 chain에서 disconnected 상태입니다. |

## EIP-1474 style error

| Code | 의미 |
| --- | --- |
| `-32000` | Invalid input. |
| `-32001` | Resource not found. |
| `-32002` | Resource unavailable. |
| `-32003` | Transaction rejected. |
| `-32004` | Method not supported. |
| `-32005` | Request limit exceeded. |

## Pali-specific common error

| Code | 의미 |
| --- | --- |
| `4101` | method는 EVM-only 또는 UTXO-only처럼 다른 chain family에서만 사용할 수 있습니다. |
| `4874` | method는 hardware wallet을 지원하지 않습니다. |
| `5720` | `wallet_sendCalls`에서 dapp이 제공한 bundle id가 중복되었습니다. |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus`의 알 수 없는 bundle id입니다. |

## Best practice

- `4001`은 일반적인 user cancellation으로 취급하세요.
- `4101`은 사용자를 올바른 network family로 안내하라는 prompt로 취급하세요.
- blocking request를 tight loop로 retry하지 마세요. Pali는 popup spam으로부터 사용자를 보호합니다.
- 특히 guardian or module configuration에서 passkey sponsor failure에 대해 actionable copy를 보여주세요.
