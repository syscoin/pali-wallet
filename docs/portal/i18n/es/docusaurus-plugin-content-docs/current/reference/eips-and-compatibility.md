---
title: EIPs y compatibilidad
---

Pali busca admitir los estándares de billetera que usan las dapps reales, mientras agrega capacidades UTXO y passkey.

## Estándares de billetera EVM

| Estándar | Soporte de Pali |
| --- | --- |
| EIP-1193 | Solicitudes/eventos/errores de proveedor mediante `window.ethereum`. |
| EIP-6963 | Descubrimiento multi-wallet y anuncio de proveedor. |
| EIP-1102 | `enable()` está deprecado en favor de métodos de solicitud de cuenta. |
| EIP-1474 | Códigos de error de estilo JSON-RPC para Ethereum RPC. |
| EIP-2255 | Métodos de permisos de billetera. |
| EIP-3085 | `wallet_addEthereumChain`. |
| EIP-3326 | `wallet_switchEthereumChain`. |
| EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities`, métodos de compatibilidad de estado. |
| EIP-712 | Firma de datos tipados mediante `eth_signTypedData_v4` y métodos relacionados. |
| EIP-747 | `wallet_watchAsset`. |

## Compatibilidad con MetaMask

Pali expone `window.ethereum` para dapps que esperan comportamiento de estilo MetaMask. También marca el proveedor como compatible con MetaMask para integraciones legacy y se anuncia mediante EIP-6963 para selección moderna de billetera.

## Extensiones de Pali más allá de EVM

Pali agrega `window.pali` para flujos UTXO/Syscoin. Estos métodos no son EIPs de Ethereum; son la API de billetera de navegador de Pali para estado de cuentas UTXO, firma PSBT, activos Syscoin y flujos de dapp de estilo Bitcoin.

## Advertencias de compatibilidad

- Las suscripciones EVM no están admitidas por el proveedor de la extensión.
- `wallet_getCallsStatus` y `wallet_showCallsStatus` son stubs de compatibilidad.
- La ejecución EOA `wallet_sendCalls` es secuencial, no verdadera atomicidad on-chain.
- Las familias de red UTXO y EVM están separadas por superficie de proveedor y estado de billetera.
