---
title: Method matrix
---

이 reference는 Pali의 현재 method registry 및 provider에서 document된 public dapp-facing method를 요약합니다.

## Wallet method

| Method | Surface | 목적 | Popup |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | lock state를 읽습니다. | No |
| `wallet_isConnected` | EVM / UTXO | site connection state를 읽습니다. | No |
| `wallet_getAccount` | EVM / UTXO | connected account object를 읽습니다. | No |
| `wallet_getAddress` | EVM / UTXO | connected address를 읽습니다. | No |
| `wallet_getPublicKey` | EVM / UTXO | public key를 읽습니다. | No |
| `wallet_getBalance` | EVM / UTXO | balance를 읽습니다. | No |
| `wallet_getChangeAddress` | UTXO | change address를 읽습니다. | No |
| `wallet_getNetwork` | EVM / UTXO | active network를 읽습니다. | No |
| `wallet_getTokens` | EVM / UTXO | token holding을 읽습니다. | No |
| `wallet_estimateFee` | EVM / UTXO | fee를 estimate합니다. | No |
| `wallet_getProviderState` | EVM | EVM provider state를 initialize합니다. | No |
| `wallet_getSysProviderState` | UTXO | UTXO provider state를 initialize합니다. | No |
| `wallet_getSysAssetMetadata` | UTXO | Syscoin asset metadata를 읽습니다. | No |
| `wallet_changeAccount` | EVM / UTXO | connected account를 변경합니다. | Yes |
| `wallet_requestPermissions` | EVM | EIP-2255 permission을 요청합니다. | Yes |
| `wallet_getPermissions` | EVM | EIP-2255 permission을 읽습니다. | No |
| `wallet_revokePermissions` | EVM | permission을 revoke하고 disconnect합니다. | No |
| `wallet_watchAsset` | EVM | asset watch를 요청합니다. | Yes |
| `wallet_addEthereumChain` | EVM | EVM chain을 추가합니다. | Yes |
| `wallet_switchEthereumChain` | EVM | EVM chain을 전환합니다. | Yes |
| `wallet_createPasskeyAccount` | EVM | passkey smart account를 생성하고 deploy합니다. | Yes |
| `wallet_sendCalls` | EVM | EIP-5792 batch request를 전송합니다. | Yes |
| `wallet_getCapabilities` | EVM | account capability를 읽습니다. | No |
| `wallet_getCallsStatus` | EVM | Compatibility stub; unknown id error. | No |
| `wallet_showCallsStatus` | EVM | Compatibility stub; `null`을 반환합니다. | No |

## EVM method

| Method group | Method |
| --- | --- |
| Accounts | `eth_requestAccounts`, `eth_accounts` |
| Transactions | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| Signing | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Network | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| Chain data | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, block 및 transaction lookup method |
| Node data | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## UTXO 및 Syscoin method

| Method | 목적 |
| --- | --- |
| `sys_requestAccounts` | UTXO account를 연결합니다. |
| `sys_getAccount` | account detail을 읽습니다. |
| `sys_isConnected` | connection state를 읽습니다. |
| `sys_getNetwork` | UTXO network를 읽습니다. |
| `sys_getPublicKey` | public key를 읽습니다. |
| `sys_getCurrentAddressPubkey` | current address pubkey를 읽습니다. |
| `sys_getBip32Path` | derivation path를 읽습니다. |
| `sys_getChangeAddress` | change address를 읽습니다. |
| `sys_getTransactions` | transaction을 읽습니다. |
| `sys_transaction` | transaction 하나를 읽습니다. |
| `sys_sign` | PSBT에 서명합니다. |
| `sys_signAndSend` | 서명하고 broadcast합니다. |
| `sys_isValidSYSAddress` | Syscoin address를 검증합니다. |
| `sys_changeUTXOEVM` | chain family를 전환합니다. |
| `sys_switchChain` | UTXO chain을 전환합니다. |

## `_sys` helper

| Helper | 목적 |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | user-minted Syscoin token을 읽습니다. |
| `window.pali._sys.getHoldingsData()` | token holding을 읽습니다. |
| `window.pali._sys.getConnectedAccountXpub()` | connected xpub을 읽습니다. |
| `window.pali._sys.getChangeAddress()` | change address를 읽습니다. |
| `window.pali._sys.getDataAsset(assetGuid)` | Syscoin data asset을 읽습니다. |
