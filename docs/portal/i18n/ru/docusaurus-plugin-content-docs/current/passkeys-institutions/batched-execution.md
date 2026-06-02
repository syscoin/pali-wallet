---
title: Пакетное выполнение
---

Passkey smart accounts поддерживают batched execution через `wallet_sendCalls`. Это позволяет пользователю подтвердить несколько вызовов одним wallet review и одним WebAuthn assertion.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="Проверка passkey batch wallet_sendCalls в Pali с decoded calldata" />
</a>
  <figcaption>Pali проверяет полный passkey batch и декодирует распространенные token calls перед одним WebAuthn approval.</figcaption>
</figure>

## Пример: approve и transferFrom

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## Атомарный UX

Когда `atomicRequired` true, пользователь должен подтвердить или отклонить весь batch. Passkey path Pali подготавливает все выбранные вызовы как single smart account execution. Dapps не должны просить пользователей подтверждать partial batches, когда business logic требует all-or-nothing behavior.

## Возможность sponsor proof

Для sponsored passkey execution dapp может передать batch-level sponsor proof через capabilities, когда применимо. Pali также поддерживает разрешение sponsor service через stored account sponsor metadata.

## Неподдерживаемый тип вызова

Passkey `wallet_sendCalls` не поддерживает contract deployment calls, выраженные как empty target transactions. Deploy contracts отдельно или используйте вызов target contract.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Passkey wallet_sendCalls batch flow"></video>
  <figcaption>Passkey batch execution flow: branded intro, decoded calls, одно passkey approval, результат транзакции.</figcaption>
</figure>
