---
title: Ошибки
---

Всегда оборачивайте provider requests в `try` / `catch`. Pali использует стандартные ошибки в стиле JSON-RPC и EIP-1193 там, где возможно, а также специфичные для кошелька ошибки для неподдерживаемых сетей, ограничений hardware wallet и состояний passkey.

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

## Распространенные категории

| Код | Значение |
| --- | --- |
| `4001` | Пользователь отклонил запрос. |
| `4100` | Неавторизованный аккаунт или метод. |
| `4101` | Метод доступен только для другого семейства цепей. |
| `4200` | Неподдерживаемый метод. |
| `4900` | Провайдер отключен. |
| `4901` | Провайдер отключен от запрошенной цепи. |
| `5720` | Дублирующийся EIP-5792 bundle id от dapp в `wallet_sendCalls`. |
| `5730` | Неизвестный EIP-5792 bundle id в `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

См. [Коды ошибок](../reference/error-codes.md) для более полной справки.
