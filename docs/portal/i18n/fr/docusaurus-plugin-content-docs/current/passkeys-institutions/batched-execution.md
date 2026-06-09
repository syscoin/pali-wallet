---
title: Exécution par lots
---

Les comptes intelligents Pali prennent en charge l’exécution par lots via `wallet_sendCalls`. L’utilisateur examine plusieurs appels et les autorise comme une seule action de compte.

```js
await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [{ version: '2.0.0', from: smartAccount, chainId: '0x39', atomicRequired: true, calls }],
});
```

Cuando `atomicRequired` es true, Pali prepara los calls seleccionados como una sola ejecución de smart account. Las llamadas de despliegue de contrato con target vacío no están soportadas en este flujo.
