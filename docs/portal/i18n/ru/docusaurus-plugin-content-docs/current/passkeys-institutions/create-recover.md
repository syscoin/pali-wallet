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

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali settings screen for recovering smart accounts" />
</a>
  <figcaption>Экран восстановления помогает вернуть доступ к смарт-аккаунту: реконструировать созданные Pali аккаунты или заменить активный валидатор через guardian recovery.</figcaption>
</figure>

Восстановление зависит от установленных модулей. Детерминированные аккаунты можно реконструировать из wallet anchor, chain, index и factory. Passkey validators требуют соответствующий WebAuthn credential. Guardian recovery может заменить активный валидатор после настроенной задержки.

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>Для восстановления и выполнения требуется WebAuthn assertion соответствующей passkey credential.</figcaption>
</figure>
