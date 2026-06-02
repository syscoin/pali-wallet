---
title: Criar e recuperar contas com passkey
---

`wallet_createPasskeyAccount` é intencionalmente idempotente para onboarding de dapp. A Pali verifica contas on-chain recuperáveis antes de criar um novo caminho de credencial/conta.

## Estrutura de smart account e fábrica

O sistema de passkey tem duas partes on-chain:

- **Fábrica:** cria contas, calcula endereços contrafactuais, expõe consultas de recuperação e pode implantar mais executar a primeira ação.
- **Smart account:** armazena metadados de recuperação, nonce, política de sponsor e valida provas de execução WebAuthn/P-256 antes de executar chamadas.

Os parâmetros da conta da fábrica incluem:

| Parâmetro | Significado |
| --- | --- |
| `recoveryId` | Âncora de recuperação escopada à carteira derivada do contexto da Pali Wallet, chain id e endereço da fábrica. |
| `passkeyX`, `passkeyY` | Coordenadas da chave pública P-256 extraídas da credencial WebAuthn. |
| `credentialIdHash` | Hash do id da credencial WebAuthn. |
| `rpIdHash` | Hash do RP ID WebAuthn a partir dos dados do authenticator. |
| `originHash`, `originLength` | Dados de vinculação à origem da extensão a partir dos dados do cliente WebAuthn. |
| `salt` | Salt de implantação que permite que uma credencial controle mais de uma smart account. |

A smart account expõe execução, validação de assinatura, nonce, política de sponsor e leituras de metadados de recuperação. A Pali usa esses metadados para reconstruir contas após perda de estado local.

## Criar com sponsorship desabilitado

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## Criar com política de sponsor

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="Popup de criação de conta com passkey da Pali com detalhes de política de sponsor obrigatória" />
</a>
  <figcaption>Sponsorship obrigatório mostra a URL do sponsor, signer e texto de política antes de o usuário aprovar.</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## Comportamento de recuperação antes da criação

Quando uma dapp solicita uma conta com passkey:

1. A Pali verifica se a chain ativa oferece suporte a smart accounts com passkey.
2. A Pali verifica se a passkey pode recuperar uma conta on-chain que corresponde à política de sponsor solicitada.
3. Se a conta correspondente existe localmente, a Pali a reutiliza.
4. Se a conta correspondente existe on-chain, mas não localmente, a Pali a importa.
5. Se uma conta existe para o mesmo hash de URL de sponsor, mas modo ou signer difere, a Pali rejeita com uma incompatibilidade de recuperação.
6. Se nenhuma conta correspondente existe, a Pali prossegue com a criação de uma nova conta.

## O que determina o endereço?

O endereço da smart account é derivado de entradas da fábrica, incluindo coordenadas públicas da passkey, hash da credencial, dados de origem, hash do RP ID, ID de recuperação e salt de implantação. O texto da URL do sponsor em si não é a seed do endereço, mas a política de sponsor é usada pela lógica de correspondência de recuperação para onboarding escopado à instituição.

## Se o usuário perde dados locais da Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Tela de configurações da Pali para recuperar smart accounts com passkey" />
</a>
  <figcaption>A tela de recuperação descobre contas com passkey on-chain que correspondem à carteira restaurada e ao authenticator.</figcaption>
</figure>

Se o perfil do navegador, o storage da extensão ou metadados locais da conta com passkey forem perdidos, a chain ainda pode conter metadados públicos suficientes para recuperar a conta:

1. O usuário restaura ou abre a Pali com o contexto da carteira que ancora o ID de recuperação.
2. A Pali solicita uma asserção WebAuthn descobrível do authenticator do usuário.
3. A Pali consulta o registro da fábrica por ID de recuperação e hash da credencial.
4. A Pali lê os metadados de recuperação de cada conta candidata.
5. A Pali ignora contas já presentes localmente.
6. A Pali importa contas correspondentes de volta para o estado local da carteira.

Para criação/recuperação orientada por dapp, a Pali também compara modo de sponsor, signer e hash de URL da conta recuperada com a política de sponsor solicitada pela dapp. Isso impede uma instituição de vincular silenciosamente o usuário a uma política de sponsor diferente da solicitada pela dapp.

## RP ID e nome da credencial

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Prompt de asserção de passkey do navegador ou sistema operacional" />
</a>
  <figcaption>Recuperação e execução exigem uma asserção WebAuthn da credencial de passkey relevante.</figcaption>
</figure>

O navegador controla o RP ID efetivo para WebAuthn de origem de extensão, a menos que um RP ID seja fornecido pelo caminho da carteira. A Pali rotula a credencial compartilhada padrão como `Pali Wallet Passkey` e usa o rótulo de conta solicitado para associação de conta voltada ao usuário.
