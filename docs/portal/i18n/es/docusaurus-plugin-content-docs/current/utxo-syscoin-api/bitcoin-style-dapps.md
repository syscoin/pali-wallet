---
title: Dapps de estilo Bitcoin
---

El proveedor UTXO de Pali hace posibles dapps de navegador para flujos de cuentas de estilo Bitcoin, incluidos Syscoin UTXO y modelos de transacción compatibles.

## Qué cambia frente a EVM

Las dapps EVM suelen pedir a una cuenta que firme un objeto de transacción. Las dapps UTXO suelen:

1. Leer estado de cuenta y UTXO.
2. Construir una PSBT.
3. Incluir una dirección de cambio.
4. Pedir a la billetera que firme.
5. Finalizar y transmitir.

## Forma mínima de integración

Envía un objeto PSBT estructurado de Pali, no una cadena Base64 sin procesar. `syscoinjs-lib` exporta `{ psbt: <base64>, assets: <cadena JSON> }`; proporciona el mapa de activos cuando corresponda. `sys_sign` devuelve un objeto firmado del mismo formato, que puede quedar parcialmente firmado. El campo `assets` devuelto está vacío; conserva por separado los metadatos de activos que necesites.

```js
import { utils as sys } from 'syscoinjs-lib';

const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

// Supply your constructed syscoinjs PSBT and optional asset map.
const paliPsbt = sys.exportPsbtToJson(psbt, assetsMap);
const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [paliPsbt],
});
```

## Buenas prácticas

- Construye PSBTs de forma determinista y muestra a los usuarios un resumen de transacción en tu app.
- Usa la dirección de cambio de Pali en vez de reutilizar direcciones de recepción.
- Maneja diferencias entre testnet/mainnet.
- Maneja errores de billetera bloqueada, rechazo e incompatibilidad de red.
- Evita solicitar xpub o firma hasta que el usuario inicie una acción significativa.
