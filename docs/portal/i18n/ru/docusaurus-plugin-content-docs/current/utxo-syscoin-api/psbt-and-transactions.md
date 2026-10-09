---
title: PSBT и транзакции
---

UTXO-приложения должны тщательно составлять транзакции, запрашивать подпись через Pali и отправлять их только после одобрения пользователя.

## Подписание PSBT

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">Проверка подписи PSBT</p>
      <p className="pali-capture-card__subtitle">Подтверждение подписания UTXO</p>
      <p className="pali-capture-card__hint">Прокрутите область предпросмотра, чтобы проверить выходы, входы, размер, вес и время блокировки.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Экран проверки подписания PSBT в Pali" />
    </div>
  </div>
  <figcaption>Pali запрашивает подтверждение пользователя перед подписанием UTXO PSBT.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Подписание и отправка

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Получение транзакций

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Проверка адреса

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Ответственность dapp

Pali подписывает то, что одобряет пользователь. Ваше приложение отвечает за составление корректных входов, выходов, комиссий, сдачи и метаданных активов в PSBT до запроса подписи.

## Выбор аккаунта

Подписание привязано к аккаунту, подключённому к запрашивающему dapp, и к одобренной сети. Метаданные PSBT не могут выбрать другой аккаунт кошелька. Если в Pali отображается другой аккаунт, перед одобрением Pali может предложить пользователю переключиться на подключённый аккаунт. Чтобы использовать другой аккаунт, измените подключение dapp и запросите новое одобрение.

Если PSBT содержит нефинализированные входы, хотя бы один нефинализированный вход должен принадлежать одобренному аккаунту. Pali подписывает только входы этого аккаунта. Поэтому совместные транзакции и транзакции с мультиподписью могут возвращаться частично подписанными; другие участники должны завершить собственные входы или добавить свои подписи. Существующие внешние подписи и поддерживаемые финализированные входы сохраняются. Полностью финализированная PSBT может быть возвращена без добавления подписей. Поддержка аппаратных кошельков по-прежнему зависит от устройства и формата транзакции.

Смена аккаунта или сети делает ожидающий запрос на подписание недействительным в прежнем контексте. Подготовьте или проверьте запрос заново и получите новое одобрение, а не повторяйте старый запрос.
