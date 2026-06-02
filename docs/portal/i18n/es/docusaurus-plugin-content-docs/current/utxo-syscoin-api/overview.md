---
title: Resumen de la API UTXO y Syscoin
---

Pali expone capacidades UTXO y Syscoin mediante `window.pali`.

Usa este proveedor cuando tu app necesita:

- acceso a cuentas Syscoin UTXO.
- firma PSBT.
- transmisión de transacciones.
- direcciones de cambio.
- xpub de la cuenta conectada.
- historial de transacciones UTXO.
- metadatos y tenencias de activos Syscoin Platform Token.

## Conectar

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Popup de conexión UTXO de Pali para una dapp Syscoin" />
</a>
  <figcaption>Las dapps UTXO se conectan mediante <code>window.pali</code>, no <code>window.ethereum</code>.</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Utilidades de proveedor

`window.pali` incluye métodos RPC basados en solicitudes y métodos helper `_sys` para lecturas comunes de activos Syscoin.

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## Reglas de familia de cadena

Los métodos UTXO requieren que la billetera esté en un contexto de red UTXO/Syscoin compatible. Si tu app también admite EVM, mantén separadas las llamadas a proveedores y maneja explícitamente el cambio de modo.
