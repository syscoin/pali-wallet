---
title: Criar e recuperar contas com passkey
---

`wallet_createPasskeyAccount` cria uma nova smart account com passkey para onboarding de dapp. A Pali cria ou seleciona uma credencial WebAuthn, implanta a smart account on-chain, confirma os metadados de recuperação implantados e grava a conta no estado local da carteira após a confirmação.

O estado local da carteira representa contas com passkey implantadas. A recuperação está disponível nas configurações da Pali para contas que já existem on-chain.

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

## Comportamento de criação e implantação

Quando uma dapp solicita uma conta com passkey:

1. A Pali verifica se a chain ativa oferece suporte a smart accounts com passkey.
2. A Pali cria um salt de implantação novo para o novo caminho de conta.
3. A Pali obtém ou cria o perfil de credencial WebAuthn.
4. A Pali calcula o endereço contrafactual e os metadados de implantação.
5. Se a política de sponsor solicitada exigir uma ação inicial `setSponsor`, a Pali solicita ao usuário uma asserção passkey sobre o hash de ação de implantação.
6. A Pali envia `createAccount` ou `createAccountAndExecute` pelo pagador de gas de implantação configurado.
7. A Pali espera a confirmação, lê os metadados de recuperação da smart account na chain e verifica se correspondem à credencial preparada e aos dados de origem.
8. Após a confirmação, a Pali cria a conta com passkey local e a conecta à dapp solicitante.

Se o endereço resultante já estiver presente localmente como uma conta com passkey implantada, a Pali pode reutilizar essa conta local.

## O que determina o endereço?

O endereço da smart account é derivado de entradas da fábrica, incluindo coordenadas públicas da passkey, hash da credencial, dados de origem, hash do RP ID, ID de recuperação e salt de implantação. Cada novo caminho de conta usa um salt de implantação novo, então uma credencial pode controlar várias smart accounts.

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

A recuperação nas Configurações descobre contas implantadas e importa cada conta correspondente exposta pelo registro para a credencial.

## RP ID e nome da credencial

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Prompt de asserção de passkey do navegador ou sistema operacional" />
</a>
  <figcaption>Recuperação e execução exigem uma asserção WebAuthn da credencial de passkey relevante.</figcaption>
</figure>

O navegador controla o RP ID efetivo para WebAuthn de origem de extensão, a menos que um RP ID seja fornecido pelo caminho da carteira. A Pali rotula a credencial compartilhada padrão como `Pali Wallet Passkey` e usa o rótulo de conta solicitado para associação de conta voltada ao usuário.
