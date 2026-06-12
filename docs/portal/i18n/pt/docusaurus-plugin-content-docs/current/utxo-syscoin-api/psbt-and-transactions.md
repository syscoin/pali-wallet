---
title: PSBT e transações
---

Aplicações UTXO devem construir transações cuidadosamente, solicitar uma assinatura por meio da Pali e fazer broadcast apenas depois que o usuário aprovar.

## Assinar uma PSBT

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">PSBT Sign Review</p>
      <p className="pali-capture-card__subtitle">UTXO signing confirmation</p>
      <p className="pali-capture-card__hint">Scroll inside the preview to inspect outputs, inputs, size, weight, and lock time.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Tela de revisão de assinatura PSBT da Pali" />
    </div>
  </div>
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

