---
title: Создание и восстановление смарт-аккаунтов
---

`wallet_prepareSmartAccount` создает смарт-аккаунт Pali для dapp onboarding. Pali выводит аккаунт, деплоит его через настроенную factory, при необходимости устанавливает запрошенный валидатор, подключает аккаунт к dapp и сохраняет долговечные metadata локально.

## Структура

- **Factory:** вычисляет детерминированные адреса и деплоит аккаунты.
- **Smart account:** выполняет calls и обращается к установленным валидаторам.
- **Validators:** ECDSA, P-256 WebAuthn passkey и composite.
- **Executors:** guardian recovery для восстановления с задержкой.

## Recovery

Восстановление зависит от установленных модулей. Детерминированные аккаунты можно реконструировать из wallet anchor, chain, index и factory. Passkey validators требуют соответствующий WebAuthn credential. Guardian recovery может заменить активный валидатор после настроенной задержки.
