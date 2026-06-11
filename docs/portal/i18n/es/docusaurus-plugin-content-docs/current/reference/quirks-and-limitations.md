---
title: Particularidades y limitaciones
---

Esta página documenta comportamiento que las dapps deben tener en cuenta.

## Conexiones y popups

- Muchos hosts de dapp pueden estar conectados.
- Cada host tiene una cuenta conectada activa a la vez.
- Los popups de aprobación bloqueantes se serializan y encolan.
- Las rutas de popup activas duplicadas pueden rechazarse.
- El spam de popups puede bloquearse temporalmente.

## Separación UTXO y EVM

- `window.ethereum` es para EVM.
- `window.pali` es para UTXO/Syscoin.
- Llamar un método de la familia de cadena incorrecta puede fallar o requerir un cambio de red.
- Cambiar entre UTXO/EVM puede desconectar y requerir reconexión.

## Estado EIP-5792

- `wallet_sendCalls` está implementado.
- `wallet_getCapabilities` está implementado.
- `wallet_getCallsStatus` está implementado; los ids de bundle desconocidos fallan con el error `5730`.
- `wallet_showCallsStatus` está implementado y muestra el estado del batch en un popup de la wallet.

## Atomicidad

- Las cuentas inteligentes passkey pueden ejecutar llamadas de lote seleccionadas mediante una ejecución de cuenta inteligente.
- Las llamadas por lotes de EOA regulares son envíos secuenciales de billetera y no deben tratarse como verdadera ejecución atómica.

## Suscripciones

`eth_subscribe` y `eth_unsubscribe` no están admitidos. Usa un proveedor RPC WebSocket dedicado para suscripciones de cadena en tiempo real.

## Passkeys

- El soporte de cuenta inteligente passkey depende de la configuración de fábrica para la cadena activa.
- Las llamadas de despliegue de contrato no están admitidas mediante passkey `wallet_sendCalls`.
- `policyText` es metadato de billetera y texto mostrado, no aplicación on-chain.
- El modo sponsor requerido depende de disponibilidad del servicio sponsor y validación de prueba.

## Iframes

Pali inyecta proveedores en páginas de nivel superior, no en iframes.
