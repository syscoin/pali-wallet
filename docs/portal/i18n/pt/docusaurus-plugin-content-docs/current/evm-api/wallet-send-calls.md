---
title: wallet_sendCalls
---

A Pali oferece suporte a `wallet_sendCalls` no estilo EIP-5792 para solicitações em lote EVM. Isso é especialmente importante para smart accounts com passkey, onde múltiplas chamadas podem ser autorizadas com uma única asserção WebAuthn.

## Verificar capacidades

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

A Pali reporta suporte atômico para smart accounts com passkey e execução atômica sem suporte para EOAs regulares.

## Enviar um lote

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
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

## Comportamento de passkey

Para smart accounts com passkey, a Pali prepara todas as chamadas selecionadas como um único lote de execução de smart account, solicita uma asserção de passkey e envia uma transação. Se a conta ainda não estiver implantada, a implantação e a execução opcional de política inicial podem fazer parte do caminho da primeira transação.

## Comportamento de EOA

Para contas EVM regulares, a Pali apresenta as chamadas e envia as chamadas selecionadas sequencialmente. Isso não é o mesmo que atomicidade on-chain. Se uma dapp exige execução verdadeiramente atômica, use uma smart account com passkey ou um contrato projetado para executar chamadas em lote atomicamente.

## Métodos de status

`wallet_getCallsStatus` e `wallet_showCallsStatus` estão implementados conforme o EIP-5792. `wallet_getCallsStatus` retorna o objeto de status padrão (`100` pendente, `200` confirmado, `500` revertido, `600` parcialmente revertido) com receipts on-chain; `wallet_showCallsStatus` abre um popup do Pali somente leitura com as mesmas informações. Os `id` fornecidos pela dapp em `wallet_sendCalls` são respeitados e retornados. Ids de bundle desconhecidos falham com o erro `5730`; ids duplicados fornecidos pela dapp, com `5720`.
