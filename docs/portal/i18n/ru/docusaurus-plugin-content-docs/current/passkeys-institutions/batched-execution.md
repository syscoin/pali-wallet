---
title: Batch execution
---

Смарт-аккаунты Pali поддерживают batch execution через `wallet_sendCalls`. Пользователь проверяет несколько calls и разрешает их как одно действие аккаунта. Когда `atomicRequired` равно true, Pali готовит выбранные calls как одно smart-account execution. Contract deployment calls с пустым target в этом flow не поддерживаются.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>Pali проверяет весь batch смарт-аккаунта и декодирует распространенные token calls перед одной авторизацией smart-account.</figcaption>
</figure>

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>Одно подтверждение атомарно выполняет весь batch.</figcaption>
</figure>
