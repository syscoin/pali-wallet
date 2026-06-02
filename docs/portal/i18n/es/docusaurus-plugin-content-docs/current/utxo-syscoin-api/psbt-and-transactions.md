---
title: PSBT y transacciones
---

Las aplicaciones UTXO deben construir transacciones cuidadosamente, solicitar una firma mediante Pali y transmitir solo después de que el usuario apruebe.

## Firmar una PSBT

<figure>
  <a className="pali-media-link" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/psbt-sign-review.png" alt="Pantalla de revisión de firma PSBT en Pali" />
</a>
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

<figure className="pali-video-card">
  <video controls poster="/img/screens/utxo-psbt-flow-video.png" src="/video/utxo-psbt-flow.mp4" title="UTXO PSBT flow in Pali"></video>
  <figcaption>Flujo UTXO: introducción con marca, construcción PSBT, revisión de firma en Pali y resultado de transmisión.</figcaption>
</figure>
