---
title: PSBT y transacciones
---

Las aplicaciones UTXO deben construir transacciones cuidadosamente, solicitar una firma mediante Pali y transmitir solo después de que el usuario apruebe.

## Firmar una PSBT

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">Revisión de firma PSBT</p>
      <p className="pali-capture-card__subtitle">Confirmación de firma UTXO</p>
      <p className="pali-capture-card__hint">Desplázate dentro de la vista previa para revisar las salidas, entradas, tamaño, peso y tiempo de bloqueo.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Pantalla de revisión de firma PSBT de Pali" />
    </div>
  </div>
  <figcaption>Pali solicita confirmación al usuario antes de firmar PSBTs UTXO.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Firmar y enviar

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Obtener transacciones

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Validar una dirección

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Responsabilidad de la dapp

Pali firma lo que el usuario aprueba. Tu aplicación es responsable de construir entradas, salidas, comisiones, cambio y metadatos de activos PSBT sensatos antes de solicitar una firma.

## Selección de cuenta

La firma queda vinculada a la cuenta conectada a la dapp solicitante y a la red aprobada. Los metadatos de una PSBT no pueden seleccionar otra cuenta de la billetera. Si Pali muestra una cuenta distinta, puede pedir al usuario que cambie a la cuenta conectada antes de la aprobación. Para usar otra cuenta, cambia la conexión de la dapp y solicita una nueva aprobación.

En una PSBT con entradas sin finalizar, al menos una entrada sin finalizar debe pertenecer a esa cuenta aprobada. Pali firma únicamente las entradas de esa cuenta. Por tanto, las transacciones compartidas y multifirma pueden devolverse parcialmente firmadas; los demás participantes deben completar sus propias entradas o firmas. Se conservan las firmas externas existentes y las entradas finalizadas compatibles. Una PSBT completamente finalizada puede devolverse sin añadir firmas. La compatibilidad con billeteras hardware sigue dependiendo del dispositivo y del formato de la transacción.

Un cambio de cuenta o de red invalida el contexto de firma pendiente. Reconstruye o vuelve a comprobar la solicitud y obtén una nueva aprobación en lugar de repetir la solicitud anterior.
