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
      <p className="pali-capture-card__title">Revisión de firma PSBT</p>
      <p className="pali-capture-card__subtitle">Confirmación de firma UTXO con detalles avanzados de la transacción.</p>
      <p className="pali-capture-card__hint">Desplázate dentro de la vista previa para revisar outputs, inputs, tamaño, peso y lock time.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Pantalla de revisión de firma PSBT en Pali" />
    </div>
  </div>
  <figcaption>Pali pide confirmación al usuario antes de firmar PSBTs UTXO.</figcaption>
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

