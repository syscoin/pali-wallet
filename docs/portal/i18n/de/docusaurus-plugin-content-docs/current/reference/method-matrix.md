---
title: Methodenmatrix
---

Diese Referenz fasst die öffentlichen dapp-seitigen Methoden zusammen, die aus Palis aktuellem Methodenregister und Providern dokumentiert sind.

## Wallet-Methoden

| Methode | Oberfläche | Zweck | Popup |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | Sperrzustand lesen. | Nein |
| `wallet_isConnected` | EVM / UTXO | Site-Verbindungszustand lesen. | Nein |
| `wallet_getAccount` | EVM / UTXO | Verbundenes Account-Objekt lesen. | Nein |
| `wallet_getAddress` | EVM / UTXO | Verbundene Adresse lesen. | Nein |
| `wallet_getPublicKey` | EVM / UTXO | Public Key lesen. | Nein |
| `wallet_getBalance` | EVM / UTXO | Balance lesen. | Nein |
| `wallet_getChangeAddress` | UTXO | Wechselgeldadresse lesen. | Nein |
| `wallet_getNetwork` | EVM / UTXO | Aktives Netzwerk lesen. | Nein |
| `wallet_getTokens` | EVM / UTXO | Token-Bestände lesen. | Nein |
| `wallet_estimateFee` | EVM / UTXO | Fees schätzen. | Nein |
| `wallet_getProviderState` | EVM | EVM-Provider-Zustand initialisieren. | Nein |
| `wallet_getSysProviderState` | UTXO | UTXO-Provider-Zustand initialisieren. | Nein |
| `wallet_getSysAssetMetadata` | UTXO | Syscoin-Asset-Metadaten lesen. | Nein |
| `wallet_changeAccount` | EVM / UTXO | Den verbundenen Account ändern. | Ja |
| `wallet_requestPermissions` | EVM | EIP-2255-Berechtigungen anfordern. | Ja |
| `wallet_getPermissions` | EVM | EIP-2255-Berechtigungen lesen. | Nein |
| `wallet_revokePermissions` | EVM | Berechtigungen widerrufen und trennen. | Nein |
| `wallet_watchAsset` | EVM | Asset-Watch anfordern. | Ja |
| `wallet_addEthereumChain` | EVM | Eine EVM-Chain hinzufügen. | Ja |
| `wallet_switchEthereumChain` | EVM | EVM-Chain wechseln. | Ja |
| `wallet_createPasskeyAccount` | EVM | Einen Passkey Smart Account erstellen und deployen. | Ja |
| `wallet_sendCalls` | EVM | Einen EIP-5792-Batch-Request senden. | Ja |
| `wallet_getCapabilities` | EVM | Account-Capabilities lesen. | Nein |
| `wallet_getCallsStatus` | EVM | Kompatibilitäts-Stub; unbekannte IDs erzeugen Fehler. | Nein |
| `wallet_showCallsStatus` | EVM | Kompatibilitäts-Stub; gibt `null` zurück. | Nein |

## EVM-Methoden

| Methodengruppe | Methoden |
| --- | --- |
| Accounts | `eth_requestAccounts`, `eth_accounts` |
| Transaktionen | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| Signatur | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Netzwerk | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| Chain-Daten | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, Block- und Transaktions-Lookup-Methoden |
| Node-Daten | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## UTXO- und Syscoin-Methoden

| Methode | Zweck |
| --- | --- |
| `sys_requestAccounts` | UTXO-Account verbinden. |
| `sys_getAccount` | Account-Details lesen. |
| `sys_isConnected` | Verbindungszustand lesen. |
| `sys_getNetwork` | UTXO-Netzwerk lesen. |
| `sys_getPublicKey` | Public Key lesen. |
| `sys_getCurrentAddressPubkey` | Aktuellen Adress-Pubkey lesen. |
| `sys_getBip32Path` | Ableitungspfad lesen. |
| `sys_getChangeAddress` | Wechselgeldadresse lesen. |
| `sys_getTransactions` | Transaktionen lesen. |
| `sys_transaction` | Eine Transaktion lesen. |
| `sys_sign` | Eine PSBT signieren. |
| `sys_signAndSend` | Signieren und broadcasten. |
| `sys_isValidSYSAddress` | Eine Syscoin-Adresse validieren. |
| `sys_changeUTXOEVM` | Chain-Familie wechseln. |
| `sys_switchChain` | UTXO-Chain wechseln. |

## `_sys`-Helfer

| Helfer | Zweck |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | Vom Benutzer gemintete Syscoin-Token lesen. |
| `window.pali._sys.getHoldingsData()` | Token-Bestände lesen. |
| `window.pali._sys.getConnectedAccountXpub()` | Verbundenes xpub lesen. |
| `window.pali._sys.getChangeAddress()` | Eine Wechselgeldadresse lesen. |
| `window.pali._sys.getDataAsset(assetGuid)` | Ein Syscoin-Daten-Asset lesen. |
