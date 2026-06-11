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

## Чем Pali отличается?

Pali построен вокруг одной идеи: границей безопасности пользователя должен быть кошелек, а не сервер. Pali может читать данные из RPC-нод, explorers и indexers, как любой browser wallet, но custody, approvals, recovery и account policy остаются у ключей пользователя и on-chain модулей.

- **Нет сервера custody или recovery.** Pali не хранит серверный ключ, cloud-based encrypted data, policy engine или recovery backdoor. Чувствительные действия подтверждаются в extension, подписываются кошельком пользователя, passkey, hardware device или smart-account validator и enforced by the chain.
- **Быстрые чтения с надежными fallbacks.** Когда Pali нужны множественные EVM contract reads, он сначала пробует Multicall3 `aggregate3`: один on-chain `eth_call`, same-block view и изоляция ошибки для каждого call. Если Multicall3 не deployed или RPC его отклоняет, Pali переходит к JSON-RPC batching; если batching недоступен, возвращается к individual calls.
- **Две семьи chains в одном кошельке.** Pali предоставляет MetaMask-compatible `window.ethereum` для EVM dapps и `window.pali` для Syscoin UTXO / Bitcoin-style flows. Dapp может работать с account-based assets, UTXOs, PSBTs и xpubs из одной extension.
- **Обычные аккаунты и smart accounts.** Пользователи могут держать рядом EOA-style accounts, hardware wallet accounts и Pali smart accounts. Обычные аккаунты просты и portable. Smart accounts добавляют programmable policy: passkeys, wallet-owned ECDSA validators, composite threshold policies, guardian recovery и custom modules.
- **Standards-first dapp integration.** Pali следует wallet APIs, которые dapps уже используют: EIP-1193, EIP-6963, EIP-2255 permissions, EIP-5792 `wallet_sendCalls`, EIP-712 typed data и MetaMask-compatible request behavior. Pali smart accounts используют ERC-7579-style validator/executor modules и ERC-4337-style execution data.
- **Programmable authorization.** В Pali smart account адрес стабилен, но signer policy может развиваться. Validator решает, кто может approve actions; executor добавляет функции вроде guardian recovery. Команда может перейти от passkey к threshold policy, добавить recovery или принять новые validator types без перемещения средств.
- **Спроектирован для более сильных будущих подписей.** Так как authorization модульная, будущие validators могут поддерживать схемы beyond ECDSA and P-256 passkeys, включая post-quantum signature designs, когда они станут практичными для target chain.
- **Безопасность важнее удобства.** Pali serializes blocking approvals, проверяет connected sites и network context, блокирует high-risk blacklist hits для sends and approvals и отделяет guardian recovery от transaction signing. Guardians могут помочь восстановить доступ после delay; они не могут незаметно тратить средства.

Направление Pali — **self-custodial programmable accounts для реальных пользователей и реальных dapps**: достаточно быстрые для повседневного использования, достаточно стандартные для разработчиков, достаточно гибкие для институций и достаточно консервативные, чтобы критичный контроль безопасности оставался у пользователя и chain.

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
