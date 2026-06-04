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
