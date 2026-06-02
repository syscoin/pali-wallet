---
title: Ejecución por lotes
---

Las cuentas inteligentes passkey admiten ejecución por lotes mediante `wallet_sendCalls`. Esto permite que el usuario apruebe varias llamadas con una revisión de billetera y una assertion WebAuthn.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="Revisión de lote passkey wallet_sendCalls en Pali con calldata decodificada" />
</a>
  <figcaption>Pali revisa el lote passkey completo y decodifica llamadas comunes de tokens antes de una aprobación WebAuthn.</figcaption>
</figure>

## Ejemplo: approve y transferFrom

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
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## UX atómica

Cuando `atomicRequired` es true, el usuario debe aprobar o rechazar el lote completo. La ruta passkey de Pali prepara todas las llamadas seleccionadas como una única ejecución de cuenta inteligente. Las dapps no deben pedir a los usuarios que aprueben lotes parciales cuando la lógica de negocio requiere comportamiento todo-o-nada.

## Capacidad de prueba de sponsor

Para ejecución passkey patrocinada, una dapp puede pasar una prueba de sponsor de nivel de lote mediante capabilities cuando corresponda. Pali también admite resolución de servicio sponsor mediante metadatos de sponsor almacenados en la cuenta.

## Tipo de llamada no admitido

Passkey `wallet_sendCalls` no admite llamadas de despliegue de contrato expresadas como transacciones con target vacío. Despliega contratos por separado o usa una llamada a un contrato target.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Passkey wallet_sendCalls batch flow"></video>
  <figcaption>Flujo de ejecución por lotes passkey: introducción con marca, llamadas decodificadas, una aprobación passkey, resultado de transacción.</figcaption>
</figure>
