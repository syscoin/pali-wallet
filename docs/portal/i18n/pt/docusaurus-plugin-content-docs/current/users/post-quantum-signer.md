---
title: Assinador pós-quântico para contas inteligentes
---

As contas inteligentes da Pali podem usar diferentes validadores. Um deles é um assinador pós-quântico local baseado em **SLH-DSA-SHA2-128s**, uma família de assinaturas baseada em hash padronizada pelo NIST no FIPS 205.

Em termos simples: ele permite que uma conta inteligente aprove ações com uma assinatura projetada para resistir a ataques quânticos conhecidos contra assinaturas ECDSA atuais.

:::caution Nota alfa
As contas inteligentes da Pali e o validador SLH-DSA ainda são infraestrutura inicial. Comece em redes de teste compatíveis ou com pequenos saldos, mantenha uma rota de recuperação ou validador alternativo e espere configuração/assinatura mais lentas que uma assinatura normal.
:::

## O que muda

Em uma conta EVM normal, uma chave privada ECDSA controla o endereço. Em uma conta inteligente, o endereço é um contrato e um validador decide o que conta como aprovação. Esse validador pode ser ECDSA, passkey, política composta ou SLH-DSA.

O que continua igual:

- O endereço da conta inteligente permanece o mesmo.
- As dapps continuam vendo um único endereço EVM.
- A Pali ainda mostra uma solicitação para revisão antes de assinar.
- Recuperação por guardiões e rotação de validadores continuam disponíveis.

O que muda:

- A configuração leva mais tempo porque a Pali prepara um cache local.
- Assinar pode demorar mais que ECDSA ou passkeys.
- O estado local do assinador deve estar disponível no dispositivo, ou será preciso regenerá-lo.

## Como ativar

1. Abra a Pali e mude para uma rede EVM compatível.
2. Abra **Settings**.
3. Entre na tela de conta inteligente ou política.
4. Escolha **Post-quantum / SLH-DSA**.
5. Mantenha a Pali aberta enquanto o cache é preparado.
6. Revise e envie a transação de troca de validador.

Se a Pali disser que o assinador local está ausente ou não corresponde ao validador ativo, regenere o estado do assinador na tela de política.

## Limite de assinaturas

O perfil SLH-DSA atual tem capacidade absoluta de `2^24` assinaturas por assinador local preparado. A Pali reserva `1,000` assinaturas para tentativas de rotação para fora dessa chave, então assinaturas normais param em `2^24 - 1,000`. Isso ainda é mais de 16 milhões de assinaturas, então usuários normais provavelmente não chegarão perto desse limite.

Se o orçamento normal acabar, a Pali para de assinar operações normais com essa chave e preserva a reserva para tentativas de rotação do validador. Ela não assina silenciosamente com um assinador esgotado.

## Referências

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [Projeto pós-quântico do NIST](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
