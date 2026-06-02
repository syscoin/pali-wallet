---
title: EIPs и совместимость
---

Pali стремится поддерживать wallet standards, которые используют реальные dapps, добавляя при этом UTXO и passkey возможности.

## Стандарты EVM wallet

| Стандарт | Поддержка Pali |
| --- | --- |
| EIP-1193 | Provider request/events/errors через `window.ethereum`. |
| EIP-6963 | Multi-wallet discovery и provider announcement. |
| EIP-1102 | `enable()` deprecated в пользу account request methods. |
| EIP-1474 | JSON-RPC style error codes для Ethereum RPC. |
| EIP-2255 | Wallet permissions methods. |
| EIP-3085 | `wallet_addEthereumChain`. |
| EIP-3326 | `wallet_switchEthereumChain`. |
| EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities`, status compatibility methods. |
| EIP-712 | Typed data signing через `eth_signTypedData_v4` и связанные методы. |
| EIP-747 | `wallet_watchAsset`. |

## Совместимость с MetaMask

Pali предоставляет `window.ethereum` для dapps, ожидающих MetaMask-style behavior. Он также помечает provider как MetaMask-compatible для legacy integrations и объявляет себя через EIP-6963 для modern wallet selection.

## Расширения Pali за пределами EVM

Pali добавляет `window.pali` для UTXO/Syscoin flows. Эти методы не являются Ethereum EIPs; это browser wallet API Pali для UTXO account state, подписания PSBT, Syscoin assets и Bitcoin-style dapp flows.

## Замечания о совместимости

- EVM subscriptions не поддерживаются extension provider.
- `wallet_getCallsStatus` и `wallet_showCallsStatus` являются compatibility stubs.
- EOA `wallet_sendCalls` execution является последовательным, а не настоящей on-chain atomicity.
- UTXO и EVM network families разделены surface провайдера и состоянием кошелька.
