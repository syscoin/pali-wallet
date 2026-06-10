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

Смарт-аккаунты Pali доступны в EVM-сетях, где factory и модули Pali существуют по адресам, которые использует Pali. В этой сборке Pali настроена тестовая сеть `zkTanenbaum` (`57057`), а поддержка zkSYS production использует ту же архитектуру после настройки production-адресов.

Инфраструктура не ограничена сетями, которые разворачивает Pali. В совместимых EVM-сетях с canonical CREATE2 support Pali может развернуть нужную настройку смарт-аккаунта прямо из кошелька: откройте Pali Settings, перейдите в Advanced и используйте кнопку Deploy в **Smart account setup**. Passkey-валидаторам нужна P-256 WebAuthn verification, которую многие современные EVM-среды предоставляют через P-256/passkey precompile.
