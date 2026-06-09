---
title: Ejecución por lotes
---

Las cuentas inteligentes de Pali soportan ejecución por lotes mediante `wallet_sendCalls`. El usuario revisa varios calls y los autoriza como una sola acción de cuenta.

```js
await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [{ version: '2.0.0', from: smartAccount, chainId: '0x39', atomicRequired: true, calls }],
});
```

Cuando `atomicRequired` es true, Pali prepara los calls seleccionados como una sola ejecución de smart account. Las llamadas de despliegue de contrato con target vacío no están soportadas en este flujo.
