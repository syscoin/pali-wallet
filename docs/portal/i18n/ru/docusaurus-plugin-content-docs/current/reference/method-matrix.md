---
title: Матрица методов
---

Эта справка суммирует публичные dapp-facing methods, задокументированные из текущего method registry и providers Pali.

## Методы кошелька

| Метод | Поверхность | Назначение | Popup |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | Читать lock state. | No |
| `wallet_isConnected` | EVM / UTXO | Читать site connection state. | No |
| `wallet_getAccount` | EVM / UTXO | Читать connected account object. | No |
| `wallet_getAddress` | EVM / UTXO | Читать connected address. | No |
| `wallet_getPublicKey` | EVM / UTXO | Читать public key. | No |
| `wallet_getBalance` | EVM / UTXO | Читать balance. | No |
| `wallet_getChangeAddress` | UTXO | Читать change address. | No |
| `wallet_getNetwork` | EVM / UTXO | Читать active network. | No |
| `wallet_getTokens` | EVM / UTXO | Читать token holdings. | No |
| `wallet_estimateFee` | EVM / UTXO | Оценить fees. | No |
| `wallet_getProviderState` | EVM | Инициализировать EVM provider state. | No |
| `wallet_getSysProviderState` | UTXO | Инициализировать UTXO provider state. | No |
| `wallet_getSysAssetMetadata` | UTXO | Читать Syscoin asset metadata. | No |
| `wallet_changeAccount` | EVM / UTXO | Изменить connected account. | Yes |
| `wallet_requestPermissions` | EVM | Запросить EIP-2255 permissions. | Yes |
| `wallet_getPermissions` | EVM | Читать EIP-2255 permissions. | No |
| `wallet_revokePermissions` | EVM | Отозвать permissions и отключить. | No |
| `wallet_watchAsset` | EVM | Запросить asset watch. | Yes |
| `wallet_addEthereumChain` | EVM | Добавить EVM chain. | Yes |
| `wallet_switchEthereumChain` | EVM | Переключить EVM chain. | Yes |
| `wallet_createPasskeyAccount` | EVM | Создать или восстановить passkey smart account. | Yes |
| `wallet_sendCalls` | EVM | Отправить EIP-5792 batch request. | Yes |
| `wallet_getCapabilities` | EVM | Читать account capabilities. | No |
| `wallet_getCallsStatus` | EVM | Compatibility stub; ошибка для неизвестных ids. | No |
| `wallet_showCallsStatus` | EVM | Compatibility stub; возвращает `null`. | No |

## Методы EVM

| Группа методов | Методы |
| --- | --- |
| Аккаунты | `eth_requestAccounts`, `eth_accounts` |
| Транзакции | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| Подписание | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Сеть | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| Данные цепи | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, block and transaction lookup methods |
| Данные узла | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## Методы UTXO и Syscoin

| Метод | Назначение |
| --- | --- |
| `sys_requestAccounts` | Подключить UTXO account. |
| `sys_getAccount` | Читать account details. |
| `sys_isConnected` | Читать connection state. |
| `sys_getNetwork` | Читать UTXO network. |
| `sys_getPublicKey` | Читать public key. |
| `sys_getCurrentAddressPubkey` | Читать current address pubkey. |
| `sys_getBip32Path` | Читать derivation path. |
| `sys_getChangeAddress` | Читать change address. |
| `sys_getTransactions` | Читать transactions. |
| `sys_transaction` | Читать transaction. |
| `sys_sign` | Подписать PSBT. |
| `sys_signAndSend` | Подписать и broadcast. |
| `sys_isValidSYSAddress` | Проверить Syscoin address. |
| `sys_changeUTXOEVM` | Переключить chain family. |
| `sys_switchChain` | Переключить UTXO chain. |

## `_sys` helpers

| Helper | Назначение |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | Читать user-minted Syscoin tokens. |
| `window.pali._sys.getHoldingsData()` | Читать token holdings. |
| `window.pali._sys.getConnectedAccountXpub()` | Читать connected xpub. |
| `window.pali._sys.getChangeAddress()` | Читать change address. |
| `window.pali._sys.getDataAsset(assetGuid)` | Читать Syscoin data asset. |
