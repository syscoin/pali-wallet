---
title: Безопасность и операции
---

Institutional passkey integrations должны проектироваться как production account infrastructure, а не просто как кнопка входа.

## Зависимость от сети и verifier

Passkey accounts зависят от поддержки zkSYS для проверки P-256 WebAuthn signatures. Не предполагайте, что passkey account можно создать в любой EVM chain только потому, что chain поддерживает smart contracts. В chain должна быть deployed passkey factory, и Pali должен иметь factory address, настроенный для активной chain.

Сегодня настроенный test deployment Pali — `zkTanenbaum` (`57057`). Рассматривайте zkSYS production как production deployment target для той же архитектуры после настройки factory в кошельке.

## Операционный checklist

- Решите, получает ли каждый пользователь общий Pali passkey account или отдельный credential.
- Решите, отключен ли sponsorship, gas-only или required.
- Поддерживайте uptime sponsor service, если используете режим `required`.
- Мониторьте relayer failures, expired deadlines и повторяющиеся idempotency keys.
- Предоставьте путь user support для потерянных устройств и failed recovery.
- Документируйте, может ли институция co-authorize execution.

## Funding и deployment

Passkey smart accounts могут быть counterfactual до первого использования. Первому execution может понадобиться deployment gas payer или sponsor path. Ваш onboarding flow должен объяснять, нужно ли пользователям пополнить аккаунт перед использованием.

Factory может вычислить account address до deployment. Это полезно для onboarding, потому что dapp или институция может показать или пополнить адрес перед первой on-chain transaction.

## Предположения восстановления

Recovery является wallet-scoped и passkey-scoped. Пользователю обычно нужны:

- восстановленный Pali wallet context
- соответствующий WebAuthn credential
- поддержка chain для passkey factory

Recovery не является custodial backdoor. Chain предоставляет discoverable public metadata и списки аккаунтов, но пользователю все равно нужны wallet recovery context и соответствующий WebAuthn credential, чтобы доказать контроль.

## Backup status credential

Pali может показывать WebAuthn credential backup status, когда браузер и authenticator его раскрывают. Рассматривайте это как operational signal, а не как on-chain security rule.

Backup status может указывать, выглядит ли credential как device-bound, backup-eligible или currently backed up/synced провайдером platform passkey. Синхронизированный passkey может повысить удобство и восстановление после потери устройства, потому что пользователь может восстановить credential через свой Apple, Google, Microsoft или другой platform account. Компромисс в том, что effective security boundary теперь включает этот platform account, его recovery process и любые устройства, где passkey синхронизирован.

| Статус credential | Последствие для policy институции | Пользовательский опыт | Граница риска |
| --- | --- | --- | --- |
| Backed up or synced | Принимайте, когда recovery аккаунта и удобство onboarding важнее строгой device isolation. | Лучший опыт замены устройства и multi-device. Часто platform default для consumer passkeys. | Доверие распространяется на platform account, platform recovery flow и synced devices. |
| Backup eligible | Решите, достаточно ли одной eligibility, потому что credential может стать synced позже. | Гибко, но пользователи могут не понимать, активна ли синхронизация. | Требует понятных user guidance и периодического пересмотра status, если value аккаунта меняется. |
| Device-bound or not backed up | Предпочитайте для high-value, treasury, admin или cold-style accounts. | Больше friction и больше support burden, если устройство потеряно. | Более сильная изоляция к конкретному authenticator или hardware key. |
| Unknown or unavailable | Избегайте для high-assurance policy decisions, если у вас нет out-of-band authenticator controls. | Пользователь может продолжить, но институция не может уверенно классифицировать credential. | Неоднозначно; не рассматривайте как доказательство cloud backup или device-bound isolation. |

Для institutional accounts с higher assurance решите и задокументируйте, приемлемы ли synced passkeys. Synced passkeys все еще безопасны для обычного использования кошелька и dapp, потому что Pali и dapp никогда не получают приватный ключ passkey, WebAuthn остается origin-bound, а platform authenticator все еще выполняет user verification. Они просто не являются правильным default для cold storage, treasury controls или больших долгосрочных балансов, если институция явно не принимает границу восстановления platform-account.

## Коммуникация с пользователем

Используйте ясный policy text. Хорошая policy объясняет:

- кто управляет sponsor service
- какие действия требуют co-authorization
- платит ли институция gas
- что происходит, если sponsor service недоступен

## Не полагайтесь на policy text для enforcement

`policyText` — это disclosure и wallet metadata field. Enforcement выполняется через on-chain policy и sponsor proof validation.
