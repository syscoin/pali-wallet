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

En cada solicitud `wallet_sendCalls`, el usuario aprueba o rechaza el lote completo y no puede deseleccionar llamadas. Una cuenta inteligente Pali compatible prepara todo el lote como una ejecución. Las llamadas de EOA son secuenciales y las ya transmitidas no se pueden revertir si falla una posterior. Este flujo de cuenta inteligente no admite despliegues de contrato con destino vacío.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>Una sola aprobación ejecuta todo el lote de forma atómica.</figcaption>
</figure>
