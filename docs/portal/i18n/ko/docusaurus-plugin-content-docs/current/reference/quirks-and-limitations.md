---
title: Quirk 및 제한 사항
---

이 page는 dapp이 고려해야 할 behavior를 document합니다.

## Connection 및 popup

- 여러 dapp host가 connected 상태일 수 있습니다.
- 각 host는 한 번에 하나의 active connected account를 가집니다.
- Blocking approval popup은 직렬화되고 queue됩니다.
- 중복 active popup route는 거부될 수 있습니다.
- Popup spam은 일시적으로 차단될 수 있습니다.

## UTXO 및 EVM 분리

- `window.ethereum`은 EVM용입니다.
- `window.pali`는 UTXO/Syscoin용입니다.
- 잘못된 chain family의 method를 호출하면 실패하거나 network switch가 필요할 수 있습니다.
- UTXO/EVM switching은 disconnect를 유발하고 reconnect가 필요할 수 있습니다.

## EIP-5792 status

- `wallet_sendCalls`가 구현되어 있습니다.
- `wallet_getCapabilities`가 구현되어 있습니다.
- `wallet_getCallsStatus`는 unsupported status lookup에 대해 unknown bundle id를 반환합니다.
- `wallet_showCallsStatus`는 no-op compatibility method입니다.

## Atomicity

- Pali smart account는 하나의 smart account execution을 통해 선택된 batch call을 execute할 수 있습니다.
- 일반 EOA batch call은 순차적인 wallet send이며 진정한 atomic execution으로 취급해서는 안 됩니다.

## Subscription

`eth_subscribe`와 `eth_unsubscribe`는 지원되지 않습니다. realtime chain subscription에는 전용 WebSocket RPC provider를 사용하세요.

## Passkey

- Pali smart account support는 active chain의 factory configuration에 의존합니다.
- Contract deployment call은 passkey `wallet_sendCalls`를 통해 지원되지 않습니다.
- `policyText`는 wallet metadata 및 display text이며 on-chain enforcement가 아닙니다.
- 현재 smart-account execution은 future capability가 sponsorship을 명시적으로 보고하지 않는 한 wallet-paid gas를 사용합니다.

## Iframe

Pali는 provider를 iframe이 아니라 top-level page에 inject합니다.
