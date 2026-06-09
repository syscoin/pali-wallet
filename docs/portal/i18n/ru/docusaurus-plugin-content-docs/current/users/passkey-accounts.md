---
title: Смарт-аккаунты и passkeys
---

Смарт-аккаунты Pali — это EVM contract accounts, контролируемые модулями. Passkey — один из поддерживаемых способов контроля; также доступны ECDSA и composite policies.

Они полезны для passkey approvals, team owners, batched actions и guardian recovery. Pali деплоит аккаунт детерминированно через factory и сохраняет долговечные metadata. Guardian recovery не мгновенная: guardian подписывает intent, модуль планирует его с delay, затем валидатор можно заменить.
