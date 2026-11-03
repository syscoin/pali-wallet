---
title: wallet_sendCalls
---

Pali поддерживает `wallet_sendCalls` в стиле EIP-5792 для пакетных EVM-запросов. Поддерживаемый смарт-аккаунт Pali может авторизовать несколько вызовов как одно исполнение.

## Проверить capabilities

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali сообщает об атомарной поддержке для поддерживаемых смарт-аккаунтов Pali и об отсутствии атомарного исполнения для обычных EOA.

## Отправить batch

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
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

## Поведение смарт-аккаунта

Пользователь одобряет или отклоняет весь запрошенный пакет; отдельные вызовы нельзя исключить. Для смарт-аккаунта Pali подготавливает весь пакет как одно исполнение, запрашивает авторизацию активного валидатора, проверяет адреса по списку блокировки кошелька и отправляет одну транзакцию. Passkey-валидатор использует WebAuthn assertion; настроенные локальные ECDSA-владельцы подписывают хеш действия.

## Поведение EOA

Для обычного EVM-аккаунта Pali показывает весь пакет для одобрения или отклонения и отправляет вызовы последовательно. Это не атомарное исполнение в блокчейне. Если dapp нужна атомарность, используйте поддерживаемый смарт-аккаунт Pali или контракт для атомарных пакетов.

## Методы статуса

`wallet_getCallsStatus` и `wallet_showCallsStatus` реализованы в соответствии с EIP-5792. `wallet_getCallsStatus` возвращает стандартный объект статуса (`100` в ожидании, `200` подтверждено, `500` revert, `600` частичный revert) с on-chain receipts; `wallet_showCallsStatus` открывает popup Pali только для чтения с той же информацией. `id`, переданные dapp в `wallet_sendCalls`, учитываются и возвращаются. Неизвестные bundle id завершаются ошибкой `5730`; дублирующиеся id от dapp — `5720`.
