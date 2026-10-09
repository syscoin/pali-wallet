---
title: Criar e recuperar smart accounts
---

`wallet_prepareSmartAccount` cria uma conta inteligente da Pali para integrar usuários por uma dapp. A Pali deriva a conta, implanta-a pela fábrica configurada, instala o validador solicitado quando necessário, conecta a conta à dapp solicitante e grava metadados duráveis da conta no estado local da carteira.

O estado local da carteira representa as contas inteligentes que a Pali pode operar. Uma conta inteligente pode ser controlada por um validador de passkey, um validador ECDSA, um validador composto ou módulos de recuperação por guardiões instalados após sua criação.

## Estrutura da conta inteligente e da fábrica

O sistema de contas inteligentes tem estas partes:

- **Fábrica:** calcula endereços determinísticos e implanta contas com os dados iniciais dos módulos.
- **Conta inteligente:** executa chamadas, acompanha os módulos instalados e solicita aos validadores que aprovem assinaturas.
- **Validadores:** autorizam ações. A Pali suporta ECDSA, passkeys P-256 WebAuthn e validadores compostos.
- **Executores:** adicionam recursos à conta. A Pali usa a recuperação por guardiões como módulo executor.

Os parâmetros de conta da fábrica incluem:

| Parâmetro | Significado |
| --- | --- |
| `salt` | Salt de implantação determinístico derivado pela Pali a partir da âncora da carteira, do índice da conta, da chain e da versão da conta. |
| `initialValidator` | Módulo validador usado na implantação inicial. A Pali usa um validador ECDSA controlado pela carteira para uma configuração determinística. |
| `initData` | Dados codificados de inicialização do validador. |

Após a implantação, a Pali pode instalar o validador solicitado e remover o inicial em um único lote da conta inteligente. Por isso, uma dapp pode solicitar uma conta controlada por passkey enquanto a Pali mantém determinístico o caminho da primeira implantação.

## Criar uma conta controlada por passkey

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

Se a dapp omitir `authenticator`, a Pali usa o caminho de passkey por padrão. Use uma solicitação que contenha apenas o identificador, como `{ id: 'p256-webauthn' }`, e deixe a Pali selecionar ou criar a credencial controlada pela carteira. Proprietários ECDSA externos continuam usando o fluxo de confirmação explícita descrito abaixo.

## Criar uma conta inteligente ECDSA

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Team account',
      authenticator: {
        id: 'ecdsa',
        config: {
          owners: ['0xOwnerAddress'],
          threshold: 1,
        },
      },
    },
  ],
});
```

Proprietários ECDSA que já são contas locais da carteira Pali são considerados controlados pela carteira. Endereços de proprietários ECDSA externos só são permitidos após um aviso e uma confirmação explícitos, porque esses endereços podem aprovar ações futuras da conta inteligente.

## Comportamento de criação e implantação

Quando uma dapp solicita uma conta inteligente:

1. A Pali verifica se a infraestrutura de contas inteligentes da Pali está configurada na chain ativa.
2. A Pali deriva o próximo descritor determinístico de conta e seu endereço contrafactual.
3. A Pali cria ou normaliza o autenticador solicitado.
4. A Pali mostra o host da dapp, o rótulo da conta, o tipo de autenticador e quaisquer proprietários ECDSA externos.
5. A Pali cria a conta localmente e a implanta on-chain com o validador inicial.
6. Se o validador solicitado for diferente do inicial, a Pali instala o solicitado e desinstala o inicial por uma execução da conta inteligente.
7. A Pali aguarda a confirmação, armazena metadados duráveis da conta inteligente e conecta a conta à dapp.

Se o endereço resultante já estiver presente localmente, a Pali poderá reutilizar essa conta inteligente local.

## O que determina o endereço?

O endereço da conta inteligente é derivado da fábrica, da implementação da conta, dos dados de inicialização do validador inicial e do salt determinístico de implantação da Pali. A Pali deriva o salt de uma âncora da carteira e do índice da conta, permitindo recuperar contas por meio dos metadados da carteira em vez de um estado local aleatório.

## Se o usuário perder os dados locais da Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Tela de configurações da Pali para recuperar contas inteligentes" />
</a>
  <figcaption>A tela de recuperação ajuda a restaurar o acesso a contas inteligentes reconstruindo contas criadas pela Pali ou usando a recuperação por guardiões para substituir o validador ativo.</figcaption>
</figure>

Se o perfil do navegador, o armazenamento da extensão ou os metadados locais da conta inteligente forem perdidos, a recuperação dependerá dos módulos atuais da conta:

- Contas determinísticas criadas pela Pali podem ser reconstruídas a partir da âncora da carteira, da chain, do índice da conta e da configuração da fábrica.
- Validadores de passkey ainda exigem a credencial WebAuthn correspondente para autorizar ações futuras.
- A recuperação por guardiões pode substituir o validador ativo após o atraso configurado se o método original de aprovação não estiver disponível.

A recuperação da Pali funciona sob autocustódia. Ela não é uma porta dos fundos do servidor e não pode contornar os módulos instalados na conta.

## RP ID e nome da credencial

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Solicitação de asserção de passkey do navegador ou sistema operacional" />
</a>
  <figcaption>A recuperação e a execução exigem uma asserção WebAuthn da credencial de passkey correspondente.</figcaption>
</figure>

O navegador controla o RP ID efetivo do WebAuthn na origem da extensão, a menos que o fluxo da carteira forneça um RP ID. A Pali rotula a credencial compartilhada padrão como `Pali Wallet Passkey` e usa o rótulo de conta solicitado para mostrar ao usuário a associação com a conta.
