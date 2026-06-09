---
title: Что такое Pali?
---

Pali Wallet — официальное расширение-кошелек Syscoin и универсальный web3-кошелек для EVM-совместимых цепей. Он рассчитан на три пересекающиеся аудитории:

- **Обычные пользователи**, которым нужен безопасный браузерный кошелек для EVM, Syscoin, Rollux и UTXO активов.
- **Dapp-разработчики**, которым нужен MetaMask-совместимый EVM-доступ и UTXO-доступ из одного расширения.
- **Институции**, которым нужны Pali smart accounts, восстановление аккаунтов, smart-account module policy и dapp-driven onboarding.

## Чем Pali отличается

Большинство браузерных кошельков предоставляют только EVM-провайдер. Pali предоставляет две взаимодополняющие поверхности:

- `window.ethereum` для EVM dapps, намеренно совместимый с распространенными MetaMask flows.
- `window.pali` для Syscoin UTXO и Bitcoin-style flows.

Это позволяет dapp создавать сценарии, которые пересекают account-based и UTXO-based цепи, не заставляя пользователей устанавливать разные кошельки.

## Краткая совместимость

| Возможность | Поддерживаемая поверхность |
| --- | --- |
| EIP-1193 provider requests | `window.ethereum` |
| EIP-6963 wallet discovery | объявление провайдера `window.ethereum` |
| Разрешения аккаунтов | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| EVM транзакции и подписи | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, связанные методы подписания |
| EIP-5792 batch requests | `wallet_sendCalls`, `wallet_getCapabilities` |
| Состояние UTXO аккаунта и xpub | `window.pali` и методы `sys_*` |
| Подписание и broadcast PSBT | `sys_sign`, `sys_signAndSend` |
| Создание Pali smart account | `wallet_prepareSmartAccount` |

## Текущий объем passkey

Pali smart accounts доступны только в EVM-сетях семейства zkSYS, где Pali настроил контракты passkey factory и цепь поддерживает проверку P-256 WebAuthn proof. В этой сборке Pali настроена тестовая сеть `zkTanenbaum` (`57057`). Поддержка zkSYS production использует ту же архитектуру после настройки production factory address в Pali. Dapps должны проверять capabilities и корректно обрабатывать неподдерживаемые цепи.
