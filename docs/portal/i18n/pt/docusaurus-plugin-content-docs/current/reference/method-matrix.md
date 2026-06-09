---
title: Matriz de métodos
---

Esta referência resume os métodos públicos voltados a dapps documentados a partir do registro de métodos e providers atuais da Pali.

## Métodos da carteira

| Método | Superfície | Propósito | Popup |
| --- | --- | --- | --- |
| `wallet_isLocked` | EVM / UTXO | Ler estado de bloqueio. | Não |
| `wallet_isConnected` | EVM / UTXO | Ler estado de conexão do site. | Não |
| `wallet_getAccount` | EVM / UTXO | Ler objeto da conta conectada. | Não |
| `wallet_getAddress` | EVM / UTXO | Ler endereço conectado. | Não |
| `wallet_getPublicKey` | EVM / UTXO | Ler chave pública. | Não |
| `wallet_getBalance` | EVM / UTXO | Ler saldo. | Não |
| `wallet_getChangeAddress` | UTXO | Ler endereço de troco. | Não |
| `wallet_getNetwork` | EVM / UTXO | Ler rede ativa. | Não |
| `wallet_getTokens` | EVM / UTXO | Ler saldos de tokens. | Não |
| `wallet_estimateFee` | EVM / UTXO | Estimar taxas. | Não |
| `wallet_getProviderState` | EVM | Inicializar estado do provider EVM. | Não |
| `wallet_getSysProviderState` | UTXO | Inicializar estado do provider UTXO. | Não |
| `wallet_getSysAssetMetadata` | UTXO | Ler metadados de ativo Syscoin. | Não |
| `wallet_changeAccount` | EVM / UTXO | Alterar a conta conectada. | Sim |
| `wallet_requestPermissions` | EVM | Solicitar permissões EIP-2255. | Sim |
| `wallet_getPermissions` | EVM | Ler permissões EIP-2255. | Não |
| `wallet_revokePermissions` | EVM | Revogar permissões e desconectar. | Não |
| `wallet_watchAsset` | EVM | Solicitar observação de ativo. | Sim |
| `wallet_addEthereumChain` | EVM | Adicionar uma chain EVM. | Sim |
| `wallet_switchEthereumChain` | EVM | Trocar chain EVM. | Sim |
| `wallet_prepareSmartAccount` | EVM | Criar e implantar uma smart account com passkey. | Sim |
| `wallet_sendCalls` | EVM | Enviar uma solicitação em lote EIP-5792. | Sim |
| `wallet_getCapabilities` | EVM | Ler capacidades da conta. | Não |
| `wallet_getCallsStatus` | EVM | Stub de compatibilidade; ids desconhecidos geram erro. | Não |
| `wallet_showCallsStatus` | EVM | Stub de compatibilidade; retorna `null`. | Não |

## Métodos EVM

| Grupo de métodos | Métodos |
| --- | --- |
| Contas | `eth_requestAccounts`, `eth_accounts` |
| Transações | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_call`, `eth_estimateGas` |
| Assinatura | `eth_sign`, `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Rede | `eth_chainId`, `net_version`, `eth_changeUTXOEVM` |
| Dados de chain | `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getProof`, `eth_getStorageAt`, métodos de consulta de bloco e transação |
| Dados de node | `eth_blockNumber`, `eth_feeHistory`, `eth_gasPrice`, `web3_clientVersion`, `web3_sha3`, `net_listening`, `net_peerCount` |

## Métodos UTXO e Syscoin

| Método | Propósito |
| --- | --- |
| `sys_requestAccounts` | Conectar conta UTXO. |
| `sys_getAccount` | Ler detalhes da conta. |
| `sys_isConnected` | Ler estado de conexão. |
| `sys_getNetwork` | Ler rede UTXO. |
| `sys_getPublicKey` | Ler chave pública. |
| `sys_getCurrentAddressPubkey` | Ler pubkey do endereço atual. |
| `sys_getBip32Path` | Ler caminho de derivação. |
| `sys_getChangeAddress` | Ler endereço de troco. |
| `sys_getTransactions` | Ler transações. |
| `sys_transaction` | Ler uma transação. |
| `sys_sign` | Assinar uma PSBT. |
| `sys_signAndSend` | Assinar e fazer broadcast. |
| `sys_isValidSYSAddress` | Validar um endereço Syscoin. |
| `sys_changeUTXOEVM` | Trocar família de chain. |
| `sys_switchChain` | Trocar chain UTXO. |

## Auxiliares `_sys`

| Auxiliar | Propósito |
| --- | --- |
| `window.pali._sys.getUserMintedTokens()` | Ler tokens Syscoin mintados pelo usuário. |
| `window.pali._sys.getHoldingsData()` | Ler saldos de tokens. |
| `window.pali._sys.getConnectedAccountXpub()` | Ler xpub conectado. |
| `window.pali._sys.getChangeAddress()` | Ler um endereço de troco. |
| `window.pali._sys.getDataAsset(assetGuid)` | Ler um ativo de dados Syscoin. |
