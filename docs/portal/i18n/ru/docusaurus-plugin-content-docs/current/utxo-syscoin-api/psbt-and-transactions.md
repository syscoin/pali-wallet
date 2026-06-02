---
title: PSBT и транзакции
---

UTXO applications должны аккуратно конструировать транзакции, запрашивать подпись через Pali и broadcast только после подтверждения пользователя.

## Подписать PSBT

<figure>
  <a className="pali-media-link" href="/img/screens/psbt-sign-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/psbt-sign-review.png" alt="Экран проверки подписания PSBT в Pali" />
</a>
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

<figure className="pali-video-card">
  <video controls poster="/img/screens/utxo-psbt-flow-video.png" src="/video/utxo-psbt-flow.mp4" title="UTXO PSBT flow в Pali"></video>
  <figcaption>UTXO flow: branded intro, построение PSBT, review подписи Pali и результат broadcast.</figcaption>
</figure>
