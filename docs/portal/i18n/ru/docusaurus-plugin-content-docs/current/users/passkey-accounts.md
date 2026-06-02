---
title: Passkey-аккаунты
---

Passkey accounts — это EVM smart accounts, контролируемые WebAuthn credentials. Вместо подписи обычным приватным ключом EOA пользователь подтверждает действия через UI device или account passkey, предоставленный браузером и операционной системой.

За кулисами WebAuthn passkeys используют P-256 signatures. zkSYS passkey accounts построены так, чтобы эти P-256 proofs могли проверяться системой smart account/factory, поэтому биометрическое или platform passkey подтверждение может авторизовать on-chain действие.

## Зачем использовать passkey account?

- Более простой institutional onboarding.
- Поддержка smart account policy.
- Опциональные sponsor services для gas или co-authorization.
- Batch execution с одним подтверждением пользователя.
- Восстановление из on-chain registry data, когда локальные metadata кошелька отсутствуют.

## Общие и отдельные passkeys

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="Экран настроек Pali для создания passkey account" />
</a>
  <figcaption>Пользователи могут создавать passkey accounts как из Settings, так и из запросов dapp.</figcaption>
</figure>

Pali может использовать общий wallet passkey profile или создать отдельный passkey credential для аккаунта. Общие passkeys удобны для пользователей, которым нужен один passkey, контролируемый кошельком. Отдельные passkeys могут помочь институциям изолировать credentials по сервисам или policy.

## Deployment

Passkey smart account может существовать как counterfactual address до того, как он будет deployed on-chain. Первое выполнение может deploy аккаунт и выполнить запрошенное действие в одном flow, если сеть и путь funding это поддерживают.

Если аккаунт еще не deployed, убедитесь, что у passkey account или payer для deployment gas достаточно native token, либо используйте institution sponsor path, поддерживающий deployment flow.

## Поддержка сетей

Passkey accounts требуют zkSYS passkey smart account contracts и поддержки P-256 verification. В этой сборке Pali тестовая сеть `zkTanenbaum` настроена для создания passkey account. Поддержка zkSYS production использует ту же модель после настройки production factory address в кошельке.

## Восстановление

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Экран настроек passkey account policy в Pali" />
</a>
  <figcaption>Экран passkey policy показывает sponsor mode, signer, URL и backup status, когда они доступны.</figcaption>
</figure>

Если локальное состояние кошелька удалено или кошелек восстановлен, Pali может восстановить passkey smart accounts из on-chain factory registry и event logs. Для восстановления все равно нужен WebAuthn assertion от соответствующего passkey.
