---
title: Dapps в стиле Bitcoin
---

UTXO provider Pali делает browser dapps возможными для Bitcoin-style account flows, включая Syscoin UTXO и совместимые transaction models.

## Что меняется по сравнению с EVM

EVM dapps обычно просят один аккаунт подписать transaction object. UTXO dapps обычно:

1. Читают account и UTXO state.
2. Строят PSBT.
3. Включают change address.
4. Просят кошелек подписать.
5. Финализируют и broadcast.

## Минимальная форма интеграции

Передавайте структурированный объект Pali PSBT, а не строку Base64. `syscoinjs-lib` экспортирует `{ psbt: <base64>, assets: <строка JSON> }`; при необходимости передайте карту активов. `sys_sign` возвращает подписанный объект того же формата, который может остаться частично подписанным. Возвращаемое поле `assets` пустое; сохраняйте необходимые метаданные активов отдельно.

```js
import { utils as sys } from 'syscoinjs-lib';

const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

// Supply your constructed syscoinjs PSBT and optional asset map.
const paliPsbt = sys.exportPsbtToJson(psbt, assetsMap);
const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [paliPsbt],
});
```

## Лучшие практики

- Стройте PSBTs детерминированно и показывайте пользователям summary транзакции в вашем приложении.
- Используйте change address Pali вместо повторного использования receive addresses.
- Обрабатывайте различия testnet/mainnet.
- Обрабатывайте ошибки wallet lock, отказа и network mismatch.
- Избегайте запросов xpub или подписания, пока пользователь не инициирует осмысленное действие.
