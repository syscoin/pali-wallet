---
title: Smart accounts da Pali
---

As smart accounts da Pali são contas de contrato que a Pali pode criar, conectar e operar para o usuário. Para uma pessoa comum, a experiência parece uma conta de carteira: revisar a solicitação da dapp, aprovar com passkey ou uma chave da carteira e deixar a Pali enviar a transação. Por baixo, a conta é modular: validadores autorizam ações e executores adicionam recursos como recuperação.

## Ideia simples

- Um único endereço mantém os fundos e é o endereço visto pelas dapps.
- A conta pode usar passkey, ECDSA ou uma política composta.
- Guardian recovery pode substituir o validador ativo depois de uma espera.
- `wallet_sendCalls` pode executar várias chamadas como uma ação atômica.

## Modelo técnico

`PaliSmartAccount` executa chamadas e valida assinaturas por módulos estilo ERC-7579. `PaliSmartAccountFactory` deriva endereços determinísticos e implanta contas. A Pali prepara execuções com codificação estilo ERC-4337 e usa EIP-1271 para assinaturas de contrato.

A conta é implantada primeiro com um validador ECDSA controlado pela carteira. Se a dapp pediu passkey ou outro validador suportado, a Pali instala o validador solicitado e remove o bootstrap validator com uma execução da conta.

## Para instituições e equipes

Instituições devem tratar essas contas como infraestrutura de conta, não apenas login com passkey. Usem passkeys para onboarding com menos atrito, ECDSA ou validadores compostos para controles de equipe ou hardware wallet, guardian recovery para substituição com atraso e contas pagadoras de gas financiadas para implantação e execução. Documentem quem controla cada validador, quem são os guardiões e o significado do atraso de recuperação.

A Pali mostra um aviso especial quando uma dapp solicita owners ECDSA externos, porque esses endereços podem aprovar ações futuras da conta.

## Método de dapp

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

Se `authenticator` não for informado, a Pali usa passkey por padrão.
