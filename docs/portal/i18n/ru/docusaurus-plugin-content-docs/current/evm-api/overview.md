---
title: Обзор EVM API
---

EVM provider Pali доступен через `window.ethereum` и совместим со стандартными MetaMask-style dapp integrations.

## Распространенные методы

| Область | Методы |
| --- | --- |
| Подключение | `eth_requestAccounts`, `eth_accounts` |
| Сеть | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| Транзакции | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| Подписание | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Разрешения | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Активы | `wallet_watchAsset` |
| Batches | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkeys | `wallet_prepareSmartAccount` |

## Форма provider request

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## Проксирование read-only RPC

Pali пересылает многие read-only Ethereum JSON-RPC методы активному RPC provider, включая запросы block, transaction, receipt, log, fee, balance, code, storage и proof.

## Неподдерживаемые subscriptions

`eth_subscribe` и `eth_unsubscribe` не поддерживаются in-wallet provider. Используйте собственный WebSocket RPC provider для состояния приложения, интенсивно использующего subscriptions.
