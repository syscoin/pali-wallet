---
title: Execução em lote
---

Smart accounts da Pali suportam execução em lote com `wallet_sendCalls`. O usuário revisa várias chamadas e as autoriza como uma única ação da conta.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>A Pali revisa o lote completo da smart account e decodifica chamadas de token comuns antes de uma única autorização da conta.</figcaption>
</figure>

```js
await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [{ version: '2.0.0', from: smartAccount, chainId: '0x39', atomicRequired: true, calls }],
});
```

Quando `atomicRequired` é true, a Pali prepara as chamadas selecionadas como uma única execução da smart account. Chamadas de implantação de contrato com target vazio não são suportadas nesse fluxo.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>Uma única aprovação executa todo o lote de forma atômica.</figcaption>
</figure>
