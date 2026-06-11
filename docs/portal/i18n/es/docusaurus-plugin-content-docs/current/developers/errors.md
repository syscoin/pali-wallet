---
title: Errores
---

Envuelve siempre las solicitudes de proveedor en `try` / `catch`. Pali usa errores estándar de estilo JSON-RPC y EIP-1193 cuando es posible, además de errores específicos de la billetera para redes no admitidas, restricciones de hardware wallet y estados passkey.

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

## Categorías comunes

| Código | Significado |
| --- | --- |
| `4001` | El usuario rechazó la solicitud. |
| `4100` | Cuenta o método no autorizado. |
| `4101` | El método solo está disponible para una familia de cadena diferente. |
| `4200` | Método no admitido. |
| `4900` | Proveedor desconectado. |
| `4901` | Proveedor desconectado de la cadena solicitada. |
| `5710` | La chain del bundle EIP-5792 no tiene RPC configurado en la wallet (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | Id de bundle EIP-5792 duplicado proporcionado por la dapp en `wallet_sendCalls`. |
| `5730` | Id de bundle EIP-5792 desconocido en `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

Consulta [Códigos de error](../reference/error-codes.md) para la referencia más extensa.
