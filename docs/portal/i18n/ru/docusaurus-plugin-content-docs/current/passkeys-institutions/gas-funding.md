---
title: Газ и финансирование
---

Авторизация смарт-аккаунта и оплата газа разделены. Валидатор разрешает действие; профинансированный wallet account платит network fee. Текущий flow Pali использует wallet-paid gas для deployment, module installation, `wallet_sendCalls` и guardian recovery. Dapps не должны обещать gasless flow, если будущая capability явно не сообщает sponsorship.

## Газ zkSYS через paymaster

В настроенных сетях, например zkTanenbaum, Pali может оплачивать подходящие отправки smart account в zkSYS через paymaster Pali. При первом использовании может потребоваться одноразовое разрешение zkSYS; эта setup transaction всё ещё может требовать native gas. Если sponsorship в zkSYS опционален и недоступен, отклонён пользователем или небезопасен для запрошенной операции, Pali возвращается к native gas. Dapps должны описывать это как оплату газа smart account в zkSYS при доступности, а не как полностью gasless flow.
