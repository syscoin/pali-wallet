---
title: wallet_sendCalls
---

A Pali oferece `wallet_sendCalls` no estilo EIP-5792 para solicitações de lote EVM. Uma conta inteligente Pali compatível pode autorizar várias chamadas como uma execução.

## Verificar capacidades

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

A Pali informa suporte atômico para contas inteligentes Pali compatíveis e ausência de execução atômica para EOAs comuns.

## Enviar um lote

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## Comportamento de contas inteligentes

O usuário aprova ou rejeita o lote solicitado inteiro; não é possível desmarcar chamadas individuais. Para contas inteligentes Pali, a Pali prepara todo o lote como uma execução, solicita autorização do validador ativo, verifica os destinos na lista de bloqueio da carteira e envia uma transação. Um validador de passkey usa uma asserção WebAuthn; proprietários ECDSA locais configurados assinam o hash da ação.

## Comportamento de EOA

Para contas EVM comuns, a Pali apresenta o lote inteiro para aprovação ou rejeição e envia suas chamadas sequencialmente. Isso não é execução atômica on-chain. Se a dapp exigir atomicidade, use uma conta inteligente Pali compatível ou um contrato projetado para lotes atômicos.

## Métodos de status

`wallet_getCallsStatus` e `wallet_showCallsStatus` estão implementados conforme o EIP-5792. `wallet_getCallsStatus` retorna o objeto de status padrão (`100` pendente, `200` confirmado, `500` revertido, `600` parcialmente revertido) com receipts on-chain; `wallet_showCallsStatus` abre um popup do Pali somente leitura com as mesmas informações. Os `id` fornecidos pela dapp em `wallet_sendCalls` são respeitados e retornados. Ids de bundle desconhecidos falham com o erro `5730`; ids duplicados fornecidos pela dapp, com `5720`.
