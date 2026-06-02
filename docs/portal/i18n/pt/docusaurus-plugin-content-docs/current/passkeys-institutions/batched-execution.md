---
title: Execução em lote
---

Smart accounts com passkey oferecem suporte a execução em lote por meio de `wallet_sendCalls`. Isso permite que o usuário aprove múltiplas chamadas com uma revisão da carteira e uma asserção WebAuthn.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="Revisão de lote de passkey wallet_sendCalls da Pali com calldata decodificado" />
</a>
  <figcaption>A Pali revisa o lote completo de passkey e decodifica chamadas comuns de token antes de uma aprovação WebAuthn.</figcaption>
</figure>

## Exemplo: approve e transferFrom

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
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## UX atômica

Quando `atomicRequired` é true, o usuário deve aprovar ou rejeitar o lote completo. O caminho de passkey da Pali prepara todas as chamadas selecionadas como uma única execução de smart account. Dapps não devem pedir que usuários aprovem lotes parciais quando a lógica de negócio exige comportamento tudo-ou-nada.

## Capacidade de prova de sponsor

Para execução patrocinada com passkey, uma dapp pode passar uma prova de sponsor no nível do lote por meio de capabilities quando aplicável. A Pali também oferece suporte à resolução de serviço de sponsor por meio de metadados de sponsor armazenados na conta.

## Tipo de chamada sem suporte

`wallet_sendCalls` com passkey não oferece suporte a chamadas de implantação de contrato expressas como transações de destino vazio. Implante contratos separadamente ou use uma chamada para um contrato de destino.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Fluxo de lote Passkey wallet_sendCalls"></video>
  <figcaption>Fluxo de execução em lote com passkey: introdução com marca, chamadas decodificadas, uma aprovação de passkey, resultado da transação.</figcaption>
</figure>
