---
title: wallet_sendCalls
---

Pali поддерживает EIP-5792-style `wallet_sendCalls` для EVM batch requests. Это особенно важно для Pali smart accounts, где несколько вызовов могут быть авторизованы одним WebAuthn assertion.

## Проверить capabilities

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali сообщает atomic support для Pali smart accounts и неподдерживаемое atomic execution для обычных EOAs.

## Отправить batch

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
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## Поведение passkey

Для Pali smart accounts Pali подготавливает все выбранные вызовы как один smart account execution batch, запрашивает один passkey assertion и отправляет одну транзакцию. Локальные smart accounts представляют подтвержденные on-chain deployments.

## Поведение EOA

Для обычных EVM accounts Pali показывает вызовы и отправляет выбранные вызовы последовательно. Это не то же самое, что on-chain atomicity. Если dapp требует настоящего atomic execution, используйте Pali smart account или контракт, designed to batch calls atomically.

## Методы статуса

`wallet_getCallsStatus` и `wallet_showCallsStatus` присутствуют для совместимости, но persistent bundle status не реализован. Считайте немедленный результат `wallet_sendCalls` и transaction hash полезным output.
