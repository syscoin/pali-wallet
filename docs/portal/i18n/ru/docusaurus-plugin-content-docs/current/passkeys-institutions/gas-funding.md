---
title: Газ и финансирование
---

Авторизация смарт-аккаунта и оплата газа разделены. Валидатор разрешает действие; профинансированный wallet account платит network fee. Текущий flow Pali использует wallet-paid gas для deployment, module installation, `wallet_sendCalls` и guardian recovery. Dapps не должны обещать gasless flow, если будущая capability явно не сообщает sponsorship.
