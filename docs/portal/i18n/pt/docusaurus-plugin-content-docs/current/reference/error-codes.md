---
title: Códigos de erro
---

A Pali usa erros JSON-RPC, EIP-1193, EIP-1474 e específicos da carteira. Dapps devem sempre inspecionar tanto `error.code` quanto `error.message`.

## JSON-RPC padrão

| Código | Significado |
| --- | --- |
| `-32700` | Erro de parse. |
| `-32600` | Solicitação inválida. |
| `-32601` | Método não encontrado ou indisponível. |
| `-32602` | Params inválidos. |
| `-32603` | Erro interno. |

## Erros de provider Ethereum

| Código | Significado |
| --- | --- |
| `4001` | Usuário rejeitou a solicitação. |
| `4100` | Conta ou método não autorizado. |
| `4200` | Método sem suporte. |
| `4900` | Provider desconectado. |
| `4901` | Provider desconectado da chain especificada. |

## Erros no estilo EIP-1474

| Código | Significado |
| --- | --- |
| `-32000` | Entrada inválida. |
| `-32001` | Recurso não encontrado. |
| `-32002` | Recurso indisponível. |
| `-32003` | Transação rejeitada. |
| `-32004` | Método sem suporte. |
| `-32005` | Limite de solicitações excedido. |

## Erros comuns específicos da Pali

| Código | Significado |
| --- | --- |
| `4101` | O método está disponível apenas para uma família de chain diferente, como somente EVM ou somente UTXO. |
| `4874` | O método não oferece suporte a hardware wallets. |
| `5720` | Id de bundle duplicado fornecido pela dapp em `wallet_sendCalls`. |
| `5730` | Id de bundle desconhecido para `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

## Boas práticas

- Trate `4001` como cancelamento normal do usuário.
- Trate `4101` como um sinal para orientar o usuário à família de rede correta.
- Não tente novamente solicitações bloqueantes em um loop apertado. A Pali protege usuários contra spam de popups.
- Mostre texto acionável para falhas de sponsor de passkey, especialmente modo de sponsor obrigatório.
