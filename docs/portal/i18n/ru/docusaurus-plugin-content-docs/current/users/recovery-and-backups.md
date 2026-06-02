---
title: Восстановление и резервные копии
---

Резервные копии важны, потому что Pali является некастодиальным. Кошелек не может восстановить для вас seed phrase, пароль, приватный ключ или секрет passkey authenticator.

## Резервная копия seed phrase

Запишите seed phrase вашего кошелька и храните ее offline. Любой, у кого есть seed phrase, может контролировать derived accounts.

## Backup status passkey

Passkeys могут быть привязаны к устройству или синхронизироваться провайдером platform account. Pali показывает backup-related status там, где он доступен, но точное поведение зависит от authenticator, браузера и операционной системы.

Вы можете видеть status, который подсказывает, является ли passkey device-bound, backup-eligible или backed up/synced. Синхронизированный passkey обычно удобнее, потому что он может следовать за вами через platform account, например Apple, Google или Microsoft. Device-bound passkey или hardware security key может быть строже, но потеря этого устройства может усложнить восстановление.

| Статус, который вы можете увидеть | Что это значит | Удобство | Компромисс безопасности | Хорошо подходит для |
| --- | --- | --- | --- | --- |
| Backed up or synced | Passkey, похоже, хранится провайдером platform passkey и может синхронизироваться с другими доверенными устройствами. | Максимальное. Часто можно восстановиться после замены телефона или ноутбука, снова войдя в platform account. | Секрет passkey все еще защищен системой platform passkey, но граница безопасности включает platform account, процесс восстановления аккаунта и синхронизированные устройства. | Повседневные кошельки, dapp accounts, institution onboarding и меньшие балансы. |
| Backup eligible | Authenticator сообщает, что passkey может быть backed up или synced, но сейчас он может не синхронизироваться. | Среднее или высокое, в зависимости от того, включена ли синхронизация. | Будущие настройки платформы могут переместить credential в cloud sync. Проверьте настройки провайдера и устройства, если это важно для вас. | Пользователи, которым нужна гибкость восстановления, но которые все еще хотят проверить, активна ли синхронизация. |
| Device-bound or not backed up | Passkey, похоже, привязан к одному authenticator или устройству. | Ниже. Если устройство потеряно и нет другого пути восстановления, восстановление может быть сложнее или невозможно. | Более сильная изоляция, потому что контроль сосредоточен в этом authenticator, а не в cloud-synced account. | Более крупные балансы, аккаунты с повышенной безопасностью, hardware security keys и использование в стиле cold wallet. |
| Unknown or unavailable | Браузер, OS или authenticator не раскрыл достаточно backup information. | Неизвестно. | Не предполагайте ни cloud recovery, ни device-bound isolation. Считайте это неоднозначным, пока не проверите настройку authenticator. | Временное использование, тестирование или случаи, где вы можете независимо проверить passkey provider. |

Cloud-synced passkeys все еще безопасны для обычного использования: приватный ключ не передается Pali или dapp, WebAuthn остается origin-bound, а user verification все еще выполняется platform authenticator. Компромисс в том, что platform account становится частью вашей модели безопасности кошелька. Для cold storage, treasury funds или больших долгосрочных балансов предпочитайте device-bound authenticator или hardware security key и держите в синхронизированных passkey accounts только меньшие операционные средства.

Backup status — это сигнал, помогающий выбрать между удобством и безопасностью. Он не заменяет резервную копию seed phrase и не означает, что Pali или институция могут восстановить секрет passkey для вас.

## Восстановление passkey accounts

Восстановление Pali passkey использует wallet-scoped recovery metadata и on-chain account discovery. Recovery flow:

1. Запрашивает discoverable WebAuthn assertion.
2. Ищет matching smart accounts из factory registry и creation logs.
3. Пропускает аккаунты, уже находящиеся в кошельке.
4. Добавляет recoverable accounts, когда sponsor metadata может быть resolved.
5. Предупреждает, если sponsor URL metadata нужна для required sponsor policy.

## Идемпотентность create/recover для dapp

Когда dapp вызывает `wallet_createPasskeyAccount`, Pali сначала проверяет, соответствует ли существующий on-chain passkey account запрошенной sponsor policy. Если matching account уже существует локально, Pali повторно использует его вместо создания дубликата. Если он существует on-chain, но не локально, Pali может восстановить его в кошелек.
