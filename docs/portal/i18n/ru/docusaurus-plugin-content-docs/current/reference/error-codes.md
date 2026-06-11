---
title: Коды ошибок
---

Pali использует JSON-RPC, EIP-1193, EIP-1474 и wallet-specific errors. Dapps должны всегда проверять и `error.code`, и `error.message`.

## Стандартный JSON-RPC

| Код | Значение |
| --- | --- |
| `-32700` | Parse error. |
| `-32600` | Invalid request. |
| `-32601` | Метод не найден или недоступен. |
| `-32602` | Invalid params. |
| `-32603` | Internal error. |

## Ошибки Ethereum provider

| Код | Значение |
| --- | --- |
| `4001` | Пользователь отклонил запрос. |
| `4100` | Неавторизованный аккаунт или метод. |
| `4200` | Неподдерживаемый метод. |
| `4900` | Провайдер отключен. |
| `4901` | Провайдер отключен от указанной цепи. |

## Ошибки в стиле EIP-1474

| Код | Значение |
| --- | --- |
| `-32000` | Invalid input. |
| `-32001` | Resource not found. |
| `-32002` | Resource unavailable. |
| `-32003` | Transaction rejected. |
| `-32004` | Method not supported. |
| `-32005` | Request limit exceeded. |

## Распространенные ошибки Pali-specific

| Код | Значение |
| --- | --- |
| `4101` | Метод доступен только для другого семейства цепей, например только EVM или только UTXO. |
| `4874` | Метод не поддерживает hardware wallets. |
| `5710` | Для сети bundle в кошельке не настроен RPC (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | Дублирующийся bundle id от dapp в `wallet_sendCalls`. |
| `5730` | Неизвестный bundle id для `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

## Лучшие практики

- Считайте `4001` обычной отменой пользователем.
- Считайте `4101` сигналом направить пользователя к правильному семейству сетей.
- Не повторяйте blocking requests в tight loop. Pali защищает пользователей от popup spam.
- Показывайте actionable copy для passkey sponsor failures, особенно в guardian or module configuration.
