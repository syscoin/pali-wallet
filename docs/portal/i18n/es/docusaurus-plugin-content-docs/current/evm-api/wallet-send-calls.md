---
title: wallet_sendCalls
---

Pali admite `wallet_sendCalls` de estilo EIP-5792 para solicitudes de lotes EVM. Una cuenta inteligente Pali compatible puede autorizar varias llamadas como una ejecución.

## Comprobar capacidades

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali informa de compatibilidad atómica para cuentas inteligentes Pali compatibles y de falta de ejecución atómica para EOA normales.

## Enviar un lote

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## Comportamiento de cuentas inteligentes

El usuario aprueba o rechaza el lote solicitado completo; no puede deseleccionar llamadas individuales. Para cuentas inteligentes Pali, Pali prepara el lote completo como una ejecución, solicita la autorización del validador activo, comprueba los destinos contra la lista de bloqueo y envía una transacción. Un validador passkey usa una aserción WebAuthn; los propietarios ECDSA locales configurados firman el hash de la acción.

## Comportamiento EOA

Para cuentas EVM normales, Pali presenta el lote completo para aprobarlo o rechazarlo y envía sus llamadas secuencialmente. Esto no es ejecución atómica en cadena. Si la dapp requiere atomicidad, usa una cuenta inteligente Pali compatible o un contrato diseñado para lotes atómicos.

## Métodos de estado

`wallet_getCallsStatus` y `wallet_showCallsStatus` están implementados según EIP-5792. `wallet_getCallsStatus` devuelve el objeto de estado estándar (`100` pendiente, `200` confirmado, `500` revertido, `600` parcialmente revertido) con receipts on-chain; `wallet_showCallsStatus` abre un popup de Pali de solo lectura con la misma información. Los `id` proporcionados por la dapp en `wallet_sendCalls` se respetan y se devuelven. Los ids de bundle desconocidos fallan con el error `5730`; los ids duplicados de la dapp, con `5720`.
