---
title: Peculiaridades e limitações
---

Esta página documenta comportamentos que dapps devem considerar.

## Conexões e popups

- Muitos hosts de dapp podem estar conectados.
- Cada host tem uma conta conectada ativa por vez.
- Popups de aprovação bloqueante são serializados e enfileirados.
- Rotas de popup ativo duplicadas podem ser rejeitadas.
- Spam de popups pode ser temporariamente bloqueado.

## Separação entre UTXO e EVM

- `window.ethereum` é para EVM.
- `window.pali` é para UTXO/Syscoin.
- Chamar um método da família de chain errada pode falhar ou exigir uma troca de rede.
- Troca UTXO/EVM pode desconectar e exigir reconexão.

## Status de EIP-5792

- `wallet_sendCalls` está implementado.
- `wallet_getCapabilities` está implementado.
- `wallet_getCallsStatus` retorna id de bundle desconhecido para consultas de status sem suporte.
- `wallet_showCallsStatus` é um método de compatibilidade sem efeito.

## Atomicidade

- Smart accounts com passkey podem executar chamadas em lote selecionadas por meio de uma execução de smart account.
- Chamadas em lote de EOAs regulares são envios sequenciais pela carteira e não devem ser tratadas como execução verdadeiramente atômica.

## Subscriptions

`eth_subscribe` e `eth_unsubscribe` não são compatíveis. Use um provider RPC WebSocket dedicado para subscriptions de chain em tempo real.

## Passkeys

- O suporte a smart account com passkey depende da configuração da fábrica para a chain ativa.
- Chamadas de implantação de contrato não são compatíveis por meio de `wallet_sendCalls` com passkey.
- `policyText` é metadado da carteira e texto de exibição, não enforcement on-chain.
- Modo de sponsor obrigatório depende da disponibilidade do serviço de sponsor e da validação da prova.

## Iframes

A Pali injeta providers em páginas de nível superior, não em iframes.
