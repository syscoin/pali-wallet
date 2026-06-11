---
title: Error codes
---

Pali uses JSON-RPC, EIP-1193, EIP-1474, and wallet-specific errors. Dapps should always inspect both `error.code` and `error.message`.

## Standard JSON-RPC

| Code | Meaning |
| --- | --- |
| `-32700` | Parse error. |
| `-32600` | Invalid request. |
| `-32601` | Method not found or unavailable. |
| `-32602` | Invalid params. |
| `-32603` | Internal error. |

## Ethereum provider errors

| Code | Meaning |
| --- | --- |
| `4001` | User rejected the request. |
| `4100` | Unauthorized account or method. |
| `4200` | Unsupported method. |
| `4900` | Provider disconnected. |
| `4901` | Provider disconnected from the specified chain. |

## EIP-1474 style errors

| Code | Meaning |
| --- | --- |
| `-32000` | Invalid input. |
| `-32001` | Resource not found. |
| `-32002` | Resource unavailable. |
| `-32003` | Transaction rejected. |
| `-32004` | Method not supported. |
| `-32005` | Request limit exceeded. |

## Pali-specific common errors

| Code | Meaning |
| --- | --- |
| `4101` | Method is only available for a different chain family, such as EVM-only or UTXO-only. |
| `4874` | Method does not support hardware wallets. |
| `5720` | Duplicate dapp-provided bundle id in `wallet_sendCalls`. |
| `5730` | Unknown bundle id for `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

## Best practices

- Treat `4001` as a normal user cancellation.
- Treat `4101` as a prompt to guide the user to the right network family.
- Do not retry blocking requests in a tight loop. Pali protects users from popup spam.
- Show actionable copy for unsupported smart-account networks, missing gas, rejected validator setup, or guardian recovery delays.
