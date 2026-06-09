---
title: Resumen de la API EVM
---

El proveedor EVM de Pali se expone mediante `window.ethereum` y es compatible con integraciones estándar de dapps de estilo MetaMask.

## Métodos comunes

| Área | Métodos |
| --- | --- |
| Conexión | `eth_requestAccounts`, `eth_accounts` |
| Red | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| Transacciones | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| Firma | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Permisos | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Activos | `wallet_watchAsset` |
| Lotes | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkeys | `wallet_prepareSmartAccount` |

## Forma de solicitud del proveedor

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## Proxy RPC de solo lectura

Pali reenvía muchos métodos Ethereum JSON-RPC de solo lectura al proveedor RPC activo, incluidas consultas de bloques, transacciones, recibos, logs, comisiones, balances, código, almacenamiento y pruebas.

## Suscripciones no admitidas

`eth_subscribe` y `eth_unsubscribe` no están admitidos por el proveedor dentro de la billetera. Usa tu propio proveedor RPC WebSocket para estado de aplicación con muchas suscripciones.
