---
title: Особенности и ограничения
---

Эта страница документирует поведение, которое dapps должны учитывать.

## Подключения и popups

- Может быть подключено много dapp hosts.
- У каждого host одновременно есть один active connected account.
- Blocking approval popups сериализуются и ставятся в очередь.
- Duplicate active popup routes могут быть отклонены.
- Popup spam может быть временно заблокирован.

## Разделение UTXO и EVM

- `window.ethereum` предназначен для EVM.
- `window.pali` предназначен для UTXO/Syscoin.
- Вызов метода из неправильного семейства цепей может завершиться ошибкой или потребовать переключение сети.
- UTXO/EVM switching может отключить и потребовать повторное подключение.

## Статус EIP-5792

- `wallet_sendCalls` реализован.
- `wallet_getCapabilities` реализован.
- `wallet_getCallsStatus` возвращает unknown bundle id для неподдерживаемых status lookups.
- `wallet_showCallsStatus` является no-op compatibility method.

## Атомарность

- Pali smart accounts могут выполнять выбранные batch calls через одно smart account execution.
- Обычные EOA batch calls являются последовательными wallet sends и не должны рассматриваться как настоящее atomic execution.

## Подписки

`eth_subscribe` и `eth_unsubscribe` не поддерживаются. Используйте dedicated WebSocket RPC provider для realtime chain subscriptions.

## Passkeys

- Поддержка Pali smart account требует, чтобы factory и модули Pali существовали в активной chain. В совместимых EVM-сетях с canonical CREATE2 support Pali может развернуть эту настройку через Settings > Advanced > **Smart account setup**.
- Contract deployment calls не поддерживаются через passkey `wallet_sendCalls`.
- `policyText` — wallet metadata и display text, а не on-chain enforcement.
- Текущий smart-account execution использует wallet-paid gas, если будущая capability явно не сообщает sponsorship.

## Iframes

Pali внедряет providers в top-level pages, а не в iframes.
