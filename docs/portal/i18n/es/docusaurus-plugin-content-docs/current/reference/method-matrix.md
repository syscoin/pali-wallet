---
title: Matriz de métodos
---

Esta referencia resume los métodos públicos orientados a dapps documentados desde el registro de métodos y proveedores actuales de Pali.

## Métodos de billetera

| Método | Superficie | Propósito | Popup |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | Leer estado de bloqueo. | No |
| `wallet_isConnected` | EVM / UTXO | Leer estado de conexión del sitio. | No |
| `wallet_getAccount` | EVM / UTXO | Leer objeto de cuenta conectada. | No |
| `wallet_getAddress` | EVM / UTXO | Leer dirección conectada. | No |
| `wallet_getPublicKey` | EVM / UTXO | Leer clave pública. | No |
| `wallet_getBalance` | EVM / UTXO | Leer balance. | No |
| `wallet_getChangeAddress` | UTXO | Leer dirección de cambio. | No |
| `wallet_getNetwork` | EVM / UTXO | Leer red activa. | No |
| `wallet_getTokens` | EVM / UTXO | Leer tenencias de tokens. | No |
| `wallet_estimateFee` | EVM / UTXO | Estimar comisiones. | No |
| `wallet_getProviderState` | EVM | Inicializar estado del proveedor EVM. | No |
| `wallet_getSysProviderState` | UTXO | Inicializar estado del proveedor UTXO. | No |
| `wallet_getSysAssetMetadata` | UTXO | Leer metadatos de activos Syscoin. | No |
| `wallet_changeAccount` | EVM / UTXO | Cambiar la cuenta conectada. | Sí |
| `wallet_requestPermissions` | EVM | Solicitar permisos EIP-2255. | Sí |
| `wallet_getPermissions` | EVM | Leer permisos EIP-2255. | No |
| `wallet_revokePermissions` | EVM | Revocar permisos y desconectar. | No |
| `wallet_watchAsset` | EVM | Solicitar observación de activo. | Sí |
| `wallet_addEthereumChain` | EVM | Agregar una cadena EVM. | Sí |
| `wallet_switchEthereumChain` | EVM | Cambiar cadena EVM. | Sí |
| `wallet_prepareSmartAccount` | EVM | Crear y desplegar una cuenta inteligente passkey. | Sí |
| `wallet_sendCalls` | EVM | Enviar una solicitud por lotes EIP-5792. | Sí |
| `wallet_getCapabilities` | EVM | Leer capacidades de cuenta. | No |
| `wallet_getCallsStatus` | EVM | Resuelve un batch enviado en estado EIP-5792 + receipts. | No |
| `wallet_showCallsStatus` | EVM | Muestra el estado del batch en un popup de la wallet. | Sí |

## Métodos EVM

| Grupo de métodos | Métodos |
| --- | --- |
| Cuentas | `eth_requestAccounts`, `eth_accounts` |
| Transacciones | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| Firma | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Red | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| Datos de cadena | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, métodos de búsqueda de bloques y transacciones |
| Datos de nodo | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## Métodos UTXO y Syscoin

| Método | Propósito |
| --- | --- |
| `sys_requestAccounts` | Conectar cuenta UTXO. |
| `sys_getAccount` | Leer detalles de cuenta. |
| `sys_isConnected` | Leer estado de conexión. |
| `sys_getNetwork` | Leer red UTXO. |
| `sys_getPublicKey` | Leer clave pública. |
| `sys_getCurrentAddressPubkey` | Leer pubkey de dirección actual. |
| `sys_getBip32Path` | Leer ruta de derivación. |
| `sys_getChangeAddress` | Leer dirección de cambio. |
| `sys_getTransactions` | Leer transacciones. |
| `sys_transaction` | Leer una transacción. |
| `sys_sign` | Firmar una PSBT. |
| `sys_signAndSend` | Firmar y transmitir. |
| `sys_isValidSYSAddress` | Validar una dirección Syscoin. |
| `sys_changeUTXOEVM` | Cambiar familia de cadena. |
| `sys_switchChain` | Cambiar cadena UTXO. |

## Helpers `_sys`

| Helper | Propósito |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | Leer tokens Syscoin acuñados por el usuario. |
| `window.pali._sys.getHoldingsData()` | Leer tenencias de tokens. |
| `window.pali._sys.getConnectedAccountXpub()` | Leer xpub conectado. |
| `window.pali._sys.getChangeAddress()` | Leer una dirección de cambio. |
| `window.pali._sys.getDataAsset(assetGuid)` | Leer un activo de datos Syscoin. |
