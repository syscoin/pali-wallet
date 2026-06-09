---
title: Batch execution
---

Смарт-аккаунты Pali поддерживают batch execution через `wallet_sendCalls`. Пользователь проверяет несколько calls и разрешает их как одно действие аккаунта. Когда `atomicRequired` равно true, Pali готовит выбранные calls как одно smart-account execution. Contract deployment calls с пустым target в этом flow не поддерживаются.
