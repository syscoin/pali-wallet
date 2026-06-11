---
title: wallet_sendCalls
---

Pali admite `wallet_sendCalls` de estilo EIP-5792 para solicitudes EVM por lotes. Esto es especialmente importante para cuentas inteligentes passkey, donde varias llamadas pueden autorizarse con una sola assertion WebAuthn.

## Comprobar capacidades

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali informa soporte atómico para cuentas inteligentes passkey y ejecución atómica no admitida para EOAs regulares.

## Enviar un lote

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
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

## Comportamiento passkey

Para cuentas inteligentes passkey, Pali prepara todas las llamadas seleccionadas como un lote de ejecución de cuenta inteligente, solicita una assertion passkey y envía una transacción. Si la cuenta no está desplegada, el despliegue y la ejecución inicial opcional de política pueden formar parte de la ruta de la primera transacción.

## Comportamiento EOA

Para cuentas EVM regulares, Pali presenta las llamadas y envía las llamadas seleccionadas secuencialmente. Eso no es lo mismo que atomicidad on-chain. Si una dapp requiere verdadera ejecución atómica, usa una cuenta inteligente passkey o un contrato diseñado para agrupar llamadas atómicamente.

## Métodos de estado

`wallet_getCallsStatus` y `wallet_showCallsStatus` están implementados según EIP-5792. `wallet_getCallsStatus` devuelve el objeto de estado estándar (`100` pendiente, `200` confirmado, `500` revertido, `600` parcialmente revertido) con receipts on-chain; `wallet_showCallsStatus` abre un popup de Pali de solo lectura con la misma información. Los `id` proporcionados por la dapp en `wallet_sendCalls` se respetan y se devuelven. Los ids de bundle desconocidos fallan con el error `5730`; los ids duplicados de la dapp, con `5720`.
