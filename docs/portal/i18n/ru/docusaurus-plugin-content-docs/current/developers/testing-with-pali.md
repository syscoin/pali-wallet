---
title: Тестирование с Pali
---

Используйте Syscoin test dapp для ручного integration testing и собственные automated tests для логики приложения.

## Размещенный test dapp

Syscoin test dapp размещен по адресу:

```text
https://syscoin-test-dapp.vercel.app/
```

Он включает Pali passkey flows, `wallet_prepareSmartAccount`, `wallet_sendCalls`, генерацию ERC-20 allowance batch и распространенные wallet requests.

## Локальный test dapp

Если вам нужно протестировать неопубликованные изменения:

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## Локальное расширение Pali

```bash
git clone https://github.com/syscoin/pali-wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

Затем загрузите `build/chrome` через developer page браузерных расширений.

## Checklist тестирования passkey

1. Подключите Pali через default provider selector.
2. Создайте или восстановите smart account с отключенным sponsorship.
3. Пополните или deploy smart account, если это требуется тестом.
4. Соберите batch ERC-20 approve плюс `transferFrom`.
5. Отправьте batch с `wallet_sendCalls`.
6. Подтвердите, что кошелек показывает decoded calldata и одно WebAuthn approval для passkey batch.
