---
title: EIPs e compatibilidade
---

A Pali busca oferecer suporte aos padrões de carteira que dapps reais usam, adicionando capacidades UTXO e passkey.

## Padrões de carteira EVM

| Padrão | Suporte da Pali |
| --- | --- |
| EIP-1193 | Solicitações/eventos/erros de provider por meio de `window.ethereum`. |
| EIP-6963 | Descoberta multi-carteira e anúncio de provider. |
| EIP-1102 | `enable()` está depreciado em favor de métodos de solicitação de conta. |
| EIP-1474 | Códigos de erro no estilo JSON-RPC para Ethereum RPC. |
| EIP-2255 | Métodos de permissões de carteira. |
| EIP-3085 | `wallet_addEthereumChain`. |
| EIP-3326 | `wallet_switchEthereumChain`. |
| EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities`, métodos de compatibilidade de status. |
| EIP-712 | Assinatura de dados tipados por meio de `eth_signTypedData_v4` e métodos relacionados. |
| EIP-747 | `wallet_watchAsset`. |

## Compatibilidade com MetaMask

A Pali expõe `window.ethereum` para dapps que esperam comportamento no estilo MetaMask. Ela também marca o provider como compatível com MetaMask para integrações legadas e se anuncia por meio de EIP-6963 para seleção moderna de carteiras.

## Extensões da Pali além de EVM

A Pali adiciona `window.pali` para fluxos UTXO/Syscoin. Esses métodos não são EIPs da Ethereum; eles são a API de carteira de navegador da Pali para estado de conta UTXO, assinatura PSBT, ativos Syscoin e fluxos de dapp no estilo Bitcoin.

## Observações de compatibilidade

- Subscriptions EVM não são compatíveis com o provider da extensão.
- `wallet_getCallsStatus` e `wallet_showCallsStatus` são stubs de compatibilidade.
- A execução EOA de `wallet_sendCalls` é sequencial, não atomicidade on-chain verdadeira.
- Famílias de rede UTXO e EVM são separadas por superfície de provider e estado da carteira.
