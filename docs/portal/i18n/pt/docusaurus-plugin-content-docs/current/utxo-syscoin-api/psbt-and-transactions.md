---
title: PSBT e transações
---

Aplicações UTXO devem construir transações cuidadosamente, solicitar uma assinatura por meio da Pali e fazer broadcast apenas depois que o usuário aprovar.

## Assinar uma PSBT

<figure>
  <a className="pali-media-link" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/psbt-sign-review.png" alt="Tela de revisão de assinatura PSBT da Pali" />
</a>
  <figcaption>A Pali pede confirmação ao usuário antes de assinar PSBTs UTXO.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Assinar e enviar

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Buscar transações

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Validar um endereço

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Responsabilidade da dapp

A Pali assina o que o usuário aprova. Sua aplicação é responsável por construir entradas, saídas, taxas, troco e metadados de ativos de PSBT sensatos antes de solicitar uma assinatura.

<figure className="pali-video-card">
  <video controls poster="/img/screens/utxo-psbt-flow-video.png" src="/video/utxo-psbt-flow.mp4" title="Fluxo PSBT UTXO na Pali"></video>
  <figcaption>Fluxo UTXO: introdução com marca, construção de PSBT, revisão de assinatura da Pali e resultado de broadcast.</figcaption>
</figure>
