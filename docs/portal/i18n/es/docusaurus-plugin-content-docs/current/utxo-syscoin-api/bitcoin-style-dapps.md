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

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Buenas prácticas

- Construye PSBTs de forma determinista y muestra a los usuarios un resumen de transacción en tu app.
- Usa la dirección de cambio de Pali en vez de reutilizar direcciones de recepción.
- Maneja diferencias entre testnet/mainnet.
- Maneja errores de billetera bloqueada, rechazo e incompatibilidad de red.
- Evita solicitar xpub o firma hasta que el usuario inicie una acción significativa.
