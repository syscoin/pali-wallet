---
title: PSBT и транзакции
---

UTXO applications должны аккуратно конструировать транзакции, запрашивать подпись через Pali и broadcast только после подтверждения пользователя.

## Подписать PSBT

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__title">Проверка подписи PSBT</p>
      <p className="pali-capture-card__subtitle">Подтверждение UTXO-подписи с расширенными деталями транзакции.</p>
      <p className="pali-capture-card__hint">Прокрутите предпросмотр, чтобы проверить outputs, inputs, размер, вес и lock time.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Экран проверки подписания PSBT в Pali" />
    </div>
  </div>
  <figcaption>Pali запрашивает подтверждение пользователя перед подписанием UTXO PSBTs.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Подписать и отправить

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Получить транзакции

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Проверить адрес

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Ответственность dapp

Pali подписывает то, что подтверждает пользователь. Ваше приложение отвечает за построение корректных PSBT inputs, outputs, fees, change и asset metadata перед запросом подписи.

