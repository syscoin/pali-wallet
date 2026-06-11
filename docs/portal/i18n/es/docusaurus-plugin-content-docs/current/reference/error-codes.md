---
title: Códigos de error
---

Pali usa errores JSON-RPC, EIP-1193, EIP-1474 y específicos de la billetera. Las dapps siempre deben inspeccionar tanto `error.code` como `error.message`.

## JSON-RPC estándar

| Código | Significado |
| --- | --- |
| `-32700` | Error de parsing. |
| `-32600` | Solicitud inválida. |
| `-32601` | Método no encontrado o no disponible. |
| `-32602` | Parámetros inválidos. |
| `-32603` | Error interno. |

## Errores de proveedor Ethereum

| Código | Significado |
| --- | --- |
| `4001` | El usuario rechazó la solicitud. |
| `4100` | Cuenta o método no autorizado. |
| `4200` | Método no admitido. |
| `4900` | Proveedor desconectado. |
| `4901` | Proveedor desconectado de la cadena especificada. |

## Errores de estilo EIP-1474

| Código | Significado |
| --- | --- |
| `-32000` | Entrada inválida. |
| `-32001` | Recurso no encontrado. |
| `-32002` | Recurso no disponible. |
| `-32003` | Transacción rechazada. |
| `-32004` | Método no admitido. |
| `-32005` | Límite de solicitudes excedido. |

## Errores comunes específicos de Pali

| Código | Significado |
| --- | --- |
| `4101` | El método solo está disponible para una familia de cadena diferente, como solo EVM o solo UTXO. |
| `4874` | El método no admite hardware wallets. |
| `5710` | La chain del bundle no tiene RPC configurado en la wallet (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | Id de bundle duplicado proporcionado por la dapp en `wallet_sendCalls`. |
| `5730` | Id de bundle desconocido para `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

## Buenas prácticas

- Trata `4001` como una cancelación normal del usuario.
- Trata `4101` como una señal para guiar al usuario a la familia de red correcta.
- No reintentes solicitudes bloqueantes en un bucle cerrado. Pali protege a los usuarios del spam de popups.
- Muestra texto accionable para fallos de sponsor passkey, especialmente en modo sponsor requerido.
