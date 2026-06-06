---
title: Contas com passkey
---

Contas com passkey são smart accounts EVM controladas por credenciais WebAuthn. Em vez de assinar com uma chave privada EOA normal, o usuário aprova ações com a UI de passkey do dispositivo ou da conta fornecida pelo navegador e pelo sistema operacional.

Por trás dos bastidores, passkeys WebAuthn usam assinaturas P-256. Contas com passkey da zkSYS são construídas para que essas provas P-256 possam ser verificadas pelo sistema de smart account/fábrica, e é por isso que uma aprovação biométrica ou de passkey de plataforma pode autorizar uma ação on-chain.

## Por que usar uma conta com passkey?

- Onboarding institucional mais fácil.
- Suporte a política de smart account.
- Serviços de sponsor opcionais para gas ou coautorização.
- Execução em lote com uma única aprovação do usuário.
- Recuperação a partir de dados de registro on-chain quando metadados locais da carteira estiverem ausentes.

## Passkeys compartilhadas e separadas

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="Tela de configurações da Pali para criar uma conta com passkey" />
</a>
  <figcaption>Usuários podem criar contas com passkey em Settings e também a partir de solicitações de dapp.</figcaption>
</figure>

A Pali pode usar um perfil de passkey compartilhado da carteira ou criar uma credencial de passkey separada para uma conta. Passkeys compartilhadas são convenientes para usuários que querem uma passkey controlada pela carteira. Passkeys separadas podem ajudar instituições a isolar credenciais por serviço ou política.

## Implantação

Uma smart account com passkey pode existir como endereço contrafactual antes de ser implantada on-chain. A primeira execução pode implantar a conta e realizar a ação solicitada em um único fluxo se a rede e o caminho de funding oferecerem suporte.

Se a conta ainda não estiver implantada, certifique-se de que a conta com passkey ou o pagador de gas de implantação tenha token nativo suficiente, ou use um caminho de sponsor institucional que ofereça suporte ao fluxo de implantação.

## Suporte de rede

Contas com passkey exigem contratos de smart account com passkey da zkSYS e suporte à verificação P-256. Nesta build da Pali, a testnet `zkTanenbaum` está configurada para criação de contas com passkey. O suporte de produção da zkSYS usa o mesmo modelo assim que o endereço da fábrica de produção estiver configurado na carteira.

## Recuperação

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Tela de configurações de política de conta com passkey da Pali" />
</a>
  <figcaption>A tela de política de passkey mostra modo de sponsor, signer, URL e status de backup quando disponíveis.</figcaption>
</figure>

Se o estado local da carteira for excluído ou a Pali for instalada em um novo dispositivo, a Pali pode recuperar smart accounts com passkey a partir do registro da fábrica on-chain e logs de eventos. Qualquer instalação da Pali com acesso à mesma credencial passkey pode descobrir as contas implantadas correspondentes após uma asserção WebAuthn, ignorar contas que já existem localmente e importar as contas selecionadas.

## Recuperação com guardiões

A Pali usa guardiões de recuperação autocustodiais para a recuperação de contas passkey em produção. Um guardião é uma carteira EVM de backup, uma conta importada ou uma carteira de hardware que o usuário controla separadamente da passkey ativa. Enquanto a passkey ainda controla a conta, o usuário pode adicionar ou remover guardiões e atualizar o período de espera da recuperação na tela de política.

A recuperação com guardiões não é instantânea. Iniciar a recuperação cria uma passkey substituta, solicita que o guardião configurado assine a intenção de recuperação e envia uma solicitação de recuperação com bloqueio temporal. Depois que o período de espera termina, qualquer pessoa pode finalizar a transação de recuperação. Em seguida, o usuário pode usar a recuperação normal de passkey para importar a conta com a passkey substituta.

A assinatura do guardião vincula a chain, o validador de recuperação com guardiões, o endereço da conta, a identidade da passkey substituta, o nonce de recuperação e a expiração. Isso impede reutilizar uma assinatura de guardião para outra conta, chain ou passkey, mas ainda permite que a transação que inicia a recuperação seja retransmitida.

Nota técnica: o validador de recuperação com guardiões armazena, por conta, o conjunto de guardiões, o limiar, o atraso e a recuperação pendente. Atualmente, a Pali expõe o fluxo simples 1-de-1 por clareza de UX, enquanto o contrato oferece suporte a políticas de limiar como 1-de-N ou M-de-N.

## Contas criadas por dapps

Dapps podem solicitar metadados de recuperação com guardiões durante `wallet_createPasskeyAccount`:

```json
{
  "label": "Trading desk",
  "recovery": {
    "guardian": {
      "address": "0x...",
      "delay": 86400
    }
  }
}
```

A Pali não anexa automaticamente um guardião fornecido por uma dapp durante a criação da conta, porque a carteira ainda não consegue autenticar esse endereço. Se uma dapp sugerir um guardião, a Pali avisa o usuário e permite criar a conta; depois o usuário pode adicionar seu próprio guardião confiável na tela de política da conta passkey. Versões futuras podem adicionar um dicionário confiável ou uma lista de permissões para guardiões padrão conhecidos.
