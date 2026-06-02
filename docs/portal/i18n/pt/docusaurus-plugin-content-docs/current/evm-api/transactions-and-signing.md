---
title: Transações e assinatura
---

Use o provider EVM para transações, mensagens pessoais e dados tipados.

## Enviar uma transação

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Tela de revisão de transação EVM da Pali" />
</a>
  <figcaption>Solicitações de transação são revisadas na Pali antes de assinatura e broadcast.</figcaption>
</figure>

```js
const [from] = await window.ethereum.request({
  method: 'eth_requestAccounts',
});

const hash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [
    {
      from,
      to: '0x0000000000000000000000000000000000000000',
      value: '0x0',
      data: '0x',
    },
  ],
});
```

## Personal sign

```js
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f2050616c69', from],
});
```

## Assinatura de dados tipados

<figure>
  <a className="pali-media-link" href="/img/screens/typed-data-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/typed-data-review.png" alt="Tela de revisão de assinatura de dados tipados da Pali" />
</a>
  <figcaption>A Pali valida e exibe dados tipados antes da aprovação do usuário.</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

A Pali valida a estrutura dos dados tipados antes de mostrar o popup de assinatura. Dapps devem usar JSON EIP-712 canônico e evitar depender de peculiaridades de parsing específicas da carteira.

## Contas com passkey e assinatura

Smart accounts com passkey podem aprovar transações e fluxos de assinatura por meio de lógica de smart account apoiada por WebAuthn. O usuário ainda aprova na Pali e pelo prompt de passkey da plataforma.
