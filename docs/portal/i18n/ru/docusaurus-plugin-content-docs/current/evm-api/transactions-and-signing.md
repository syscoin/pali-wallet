---
title: Транзакции и подписание
---

Используйте EVM provider для транзакций, personal messages и typed data.

## Отправить транзакцию

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Экран проверки EVM транзакции в Pali" />
</a>
  <figcaption>Запросы транзакций просматриваются в Pali перед подписанием и broadcast.</figcaption>
</figure>

```js
const [from] = await window.ethereum.request({
  method: 'eth_requestAccounts',
});

const hash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [
    {
      from,
      to: '0x0000000000000000000000000000000000000000',
      value: '0x0',
      data: '0x',
    },
  ],
});
```

## Подписание personal_sign

```js
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f2050616c69', from],
});
```

## Подписание typed data

<figure>
  <a className="pali-media-link" href="/img/screens/typed-data-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/typed-data-review.png" alt="Экран проверки подписания typed data в Pali" />
</a>
  <figcaption>Pali валидирует и показывает typed data перед подтверждением пользователя.</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Pali валидирует структуру typed data перед показом signing popup. Dapps должны использовать canonical EIP-712 JSON и не полагаться на wallet-specific parsing quirks.

## Smart accounts и подписание

Pali smart accounts могут подтверждать транзакции и signing flows через WebAuthn-backed smart account logic. Пользователь все равно подтверждает действие в Pali и через platform passkey prompt.
