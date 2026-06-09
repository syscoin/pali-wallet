---
title: Execução em lote
---

Smart accounts da Pali suportam execução em lote com `wallet_sendCalls`. O usuário revisa várias chamadas e as autoriza como uma única ação da conta.

```js
await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [{ version: '2.0.0', from: smartAccount, chainId: '0x39', atomicRequired: true, calls }],
});
```

Quando `atomicRequired` é true, a Pali prepara as chamadas selecionadas como uma única execução da smart account. Chamadas de implantação de contrato com target vazio não são suportadas nesse fluxo.
