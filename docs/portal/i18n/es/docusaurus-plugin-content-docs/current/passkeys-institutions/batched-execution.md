---
title: Ejecución por lotes
---

Las cuentas inteligentes de Pali soportan ejecución por lotes mediante `wallet_sendCalls`. El usuario revisa varios calls y los autoriza como una sola acción de cuenta.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>Pali revisa el lote completo de la cuenta inteligente y decodifica los calls de token comunes antes de una sola autorización de la cuenta.</figcaption>
</figure>

```js
await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [{ version: '2.0.0', from: smartAccount, chainId: '0x39', atomicRequired: true, calls }],
});
```

Cuando `atomicRequired` es true, Pali prepara los calls seleccionados como una sola ejecución de smart account. Las llamadas de despliegue de contrato con target vacío no están soportadas en este flujo.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>Una sola aprobación ejecuta todo el lote de forma atómica.</figcaption>
</figure>
