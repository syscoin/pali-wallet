---
title: Smart accounts e passkeys
---

Smart accounts da Pali são contas EVM de contrato controladas por módulos. Um passkey é uma forma suportada de controlá-las; elas também podem usar ECDSA ou políticas compostas.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>Os usuários podem criar smart accounts modulares pelas Configurações ou por solicitações de dapps e depois escolher o validador que controla as aprovações.</figcaption>
</figure>

## Por que usar

- Aprovações com passkey para uso diário.
- Owners ECDSA quando uma carteira ou equipe deve controlar a conta.
- Validadores composite para cogestão.
- Ações em lote e guardian recovery.

Pense nos validadores como a resposta à pergunta "quem pode aprovar ações desta conta?" — e a parte útil é que a resposta pode mudar sem mudar a sua conta:

- **Qualquer um dos meus logins** (1-of-N): aprove com o passkey ou a chave que estiver à mão.
- **Alguns de nós juntos** (t-of-N): um quórum de pessoas ou dispositivos precisa concordar, ideal para fundos compartilhados.
- **Todos nós juntos** (N-of-N): todo login configurado precisa aprovar, para as contas mais sensíveis.

As políticas podem até conter outras políticas, então uma equipe pode expressar coisas como "a chave do líder mais quaisquer dois passkeys do desk". Seu endereço, seus saldos e seu histórico permanecem exatamente os mesmos quando a política muda — e como a assinatura é modular, tipos de assinatura futuros (incluindo pós-quânticos) podem ser adotados na mesma conta mais tarde.

Guardiões intencionalmente **não** fazem parte desta lista. Um guardião nunca pode aprovar uma transação; seu único poder é iniciar uma recuperação lenta e visível se você perder o acesso. Essa separação protege você contra a perda de acesso sem dar a ninguém o controle do dia a dia.

## Implantação

A Pali deriva o endereço de forma determinística, implanta pela factory e salva metadados duráveis. A implantação começa com um bootstrap validator ECDSA da carteira; depois a Pali instala o validador solicitado se ele for diferente.

## Guardian recovery

Guardian recovery não é instantânea. Um guardião assina uma intenção, o módulo a agenda com atraso, e depois qualquer pessoa pode finalizar a substituição do validador. A Pali usa um salt novo por tentativa e permite apenas uma recovery ativa por conta.

On-chain, um guardião não se limita a uma chave normal: as aprovações de guardiões são verificadas com ECDSA ou ERC-1271, então um guardião também pode ser uma conta de contrato implantada — incluindo outra smart account cuja própria política seja um validador composite, personalizado ou pós-quântico. O caminho de recuperação herda então o esquema de assinatura desse guardião. As telas atuais de guardiões da Pali coletam aprovações baseadas em chaves; fluxos para guardiões de conta de contrato podem ser adicionados depois, porque o módulo implantado já os suporta.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>A tela de política da smart account mostra os módulos instalados, os detalhes do validador ativo, guardian recovery e o gerenciamento de módulos.</figcaption>
</figure>
