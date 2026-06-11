---
title: Method matrix
---

This reference summarizes the public dapp-facing methods documented from Pali's current method registry and providers.

## Wallet methods

| Method | Surface | Purpose | Popup |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | Read lock state. | No |
| `wallet_isConnected` | EVM / UTXO | Read site connection state. | No |
| `wallet_getAccount` | EVM / UTXO | Read connected account object. | No |
| `wallet_getAddress` | EVM / UTXO | Read connected address. | No |
| `wallet_getPublicKey` | EVM / UTXO | Read public key. | No |
| `wallet_getBalance` | EVM / UTXO | Read balance. | No |
| `wallet_getChangeAddress` | UTXO | Read change address. | No |
| `wallet_getNetwork` | EVM / UTXO | Read active network. | No |
| `wallet_getTokens` | EVM / UTXO | Read token holdings. | No |
| `wallet_estimateFee` | EVM / UTXO | Estimate fees. | No |
| `wallet_getProviderState` | EVM | Initialize EVM provider state. | No |
| `wallet_getSysProviderState` | UTXO | Initialize UTXO provider state. | No |
| `wallet_getSysAssetMetadata` | UTXO | Read Syscoin asset metadata. | No |
| `wallet_changeAccount` | EVM / UTXO | Change the connected account. | Yes |
| `wallet_requestPermissions` | EVM | Request EIP-2255 permissions. | Yes |
| `wallet_getPermissions` | EVM | Read EIP-2255 permissions. | No |
| `wallet_revokePermissions` | EVM | Revoke permissions and disconnect. | No |
| `wallet_watchAsset` | EVM | Request asset watch. | Yes |
| `wallet_addEthereumChain` | EVM | Add an EVM chain. | Yes |
| `wallet_switchEthereumChain` | EVM | Switch EVM chain. | Yes |
| `wallet_prepareSmartAccount` | EVM | Create, deploy, and connect a Pali smart account. | Yes |
| `wallet_sendCalls` | EVM | Send an EIP-5792 batch request. | Yes |
| `wallet_getCapabilities` | EVM | Read account capabilities. | No |
| `wallet_getCallsStatus` | EVM | Resolve a sent batch into EIP-5792 status + receipts. | No |
| `wallet_showCallsStatus` | EVM | Show batch status in a wallet popup. | Yes |

## EVM methods

| Method group | Methods |
| --- | --- |
| Accounts | `eth_requestAccounts`, `eth_accounts` |
| Transactions | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| Signing | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Network | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| Chain data | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, block and transaction lookup methods |
| Node data | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## UTXO and Syscoin methods

| Method | Purpose |
| --- | --- |
| `sys_requestAccounts` | Connect UTXO account. |
| `sys_getAccount` | Read account details. |
| `sys_isConnected` | Read connection state. |
| `sys_getNetwork` | Read UTXO network. |
| `sys_getPublicKey` | Read public key. |
| `sys_getCurrentAddressPubkey` | Read current address pubkey. |
| `sys_getBip32Path` | Read derivation path. |
| `sys_getChangeAddress` | Read change address. |
| `sys_getTransactions` | Read transactions. |
| `sys_transaction` | Read a transaction. |
| `sys_sign` | Sign a PSBT. |
| `sys_signAndSend` | Sign and broadcast. |
| `sys_isValidSYSAddress` | Validate a Syscoin address. |
| `sys_changeUTXOEVM` | Switch chain family. |
| `sys_switchChain` | Switch UTXO chain. |

## `_sys` helpers

| Helper | Purpose |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | Read user-minted Syscoin tokens. |
| `window.pali._sys.getHoldingsData()` | Read token holdings. |
| `window.pali._sys.getConnectedAccountXpub()` | Read connected xpub. |
| `window.pali._sys.getChangeAddress()` | Read a change address. |
| `window.pali._sys.getDataAsset(assetGuid)` | Read a Syscoin data asset. |
