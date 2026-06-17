---
title: Contas inteligentes SLH-DSA
---

As contas inteligentes da Pali aceitam validadores modulares. O validador pós-quântico usa assinaturas locais **SLH-DSA-SHA2-128s** gerenciadas pela Pali. Nas APIs, o id do autenticador é `slh-dsa`.

:::caution Nota alfa
As contas inteligentes da Pali e o SLH-DSA ainda são infraestrutura inicial. Use redes de teste compatíveis ou contas com pequenos saldos, mantenha recuperação ou um validador alternativo e não crie UX de dapp baseada em tempos fixos de configuração ou assinatura.
:::

## Solicitação da dapp

Solicite uma conta inteligente com `wallet_prepareSmartAccount`:

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Conta pós-quântica de teste',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

Não inclua `keyId`, `pkSeed`, `pkRoot` nem material de chave SLH-DSA. A Pali gera e gerencia o assinador local. Chaves SLH-DSA fornecidas por dapps são rejeitadas para evitar contas que a Pali não consiga assinar.

## Fluxo de assinatura

A Pali assina o hash de ação da conta inteligente com o assinador SLH-DSA local. Antes de assinar, ela verifica a conta alvo, os metadados hidratados, o validador ativo `slh-dsa`, a correspondência da chave pública e a capacidade da sessão de descriptografar o estado local.

Se alguma verificação falhar, a Pali não assina e pede para regenerar o estado local ou usar outro método de aprovação.

## Limites e gas

- capacidade absoluta por chave: `2^24`;
- limite de assinatura normal: `2^24 - 1,000`;
- assinaturas reservadas para rotação: `1,000`;
- tamanho da assinatura: `3,856` bytes;
- `preVerificationGas` SLH-DSA: `130,000`;
- `verificationGasLimit` SLH-DSA: `700,000` como limite conservador.

Quando `signatureCount >= signatureLimit`, a Pali para de assinar operações normais com essa chave e só permite o orçamento reservado para execuções explícitas de `rotateValidator`. Dapps não devem assumir tempos fixos de assinatura.

## Referências

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
