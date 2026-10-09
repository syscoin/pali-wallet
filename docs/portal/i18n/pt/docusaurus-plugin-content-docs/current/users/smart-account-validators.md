---
title: Contas inteligentes e validadores
---

As contas inteligentes da Pali são contas de contrato EVM que podem ser controladas por módulos. Uma passkey é uma das formas compatíveis de controlar uma conta inteligente. Em vez de assinar cada ação com a chave privada de uma EOA comum, o usuário pode aprovar ações pela interface de passkeys do navegador ou do sistema operacional.

Internamente, as passkeys WebAuthn usam assinaturas P-256. O validador de passkeys da Pali foi projetado para que a conta inteligente possa verificar essas provas P-256. Por isso, uma aprovação biométrica ou por passkey da plataforma pode autorizar uma ação on-chain sem expor a chave privada da passkey à Pali ou à dapp.

## Por que usar uma conta inteligente?

- Métodos modulares de aprovação para o uso diário.
- Controle ECDSA da carteira quando uma chave de carteira comum deve ser proprietária da conta.
- Políticas de gestão compartilhada por validadores compostos.
- Execução em lote com uma única aprovação do usuário.
- Recuperação por guardiões após um bloqueio temporal.
- Criação determinística para que a Pali possa reconstruir os registros das contas.

## Passkeys, ECDSA e contas de gestão compartilhada

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Tela de configurações da Pali para criar uma conta inteligente" />
</a>
  <figcaption>Os usuários podem criar contas inteligentes modulares pelas Configurações ou por solicitações de dapps e escolher o validador que controla as aprovações.</figcaption>
</figure>

A Pali oferece três tipos de validadores:

- **Passkey:** o navegador ou o sistema operacional solicita uma aprovação WebAuthn.
- **ECDSA:** os endereços EVM dos proprietários configurados aprovam as ações da conta.
- **Composto:** validadores filhos são combinados sob um limiar, como passkey ou ECDSA.

Pense nos validadores como a resposta à pergunta “quem pode aprovar ações desta conta?”. A parte útil é que a resposta pode mudar sem mudar a sua conta:

- **Qualquer um dos meus acessos** (1-of-N): aprove com a passkey ou a chave que estiver à mão.
- **Alguns de nós juntos** (t-of-N): um quórum de pessoas ou dispositivos precisa concordar, ideal para fundos compartilhados.
- **Todos nós juntos** (N-of-N): todos os acessos configurados precisam aprovar, para as contas mais sensíveis.

As políticas podem até conter outras políticas, permitindo que uma equipe expresse regras como “a chave do responsável mais quaisquer duas passkeys da mesa de operações”. Seu endereço, seus saldos e seu histórico permanecem exatamente iguais quando a política muda. Como a assinatura é modular, tipos de assinatura futuros, incluindo pós-quânticos, podem ser adotados na mesma conta mais tarde.

Os guardiões intencionalmente **não** fazem parte desta lista. Um guardião nunca pode aprovar uma transação; seu único poder é iniciar uma recuperação lenta e visível se você perder o acesso. Essa separação protege você contra a perda de acesso sem dar a ninguém o controle do dia a dia.

A Pali pode usar um perfil de passkey compartilhado da carteira ou criar uma credencial de passkey separada para uma conta. Passkeys compartilhadas são convenientes para quem quer uma única passkey controlada pela carteira. Passkeys separadas podem ajudar a isolar credenciais por serviço ou política.

## Implantação

Uma conta inteligente pode existir como endereço contrafactual enquanto a Pali prepara sua criação. A Pali deriva o endereço a partir de entradas determinísticas da fábrica, implanta pela fábrica da Pali e salva metadados duráveis da conta localmente.

A conta começa com um validador inicial controlado pela carteira para uma implantação determinística. Se o usuário ou a dapp selecionou uma passkey ou outro validador, a Pali instala esse validador e remove o inicial por uma execução da conta inteligente.

## Redes compatíveis

As contas inteligentes exigem que a fábrica da Pali e os contratos dos módulos existam nos endereços usados pela Pali para a chain ativa. Nesta versão da Pali, a rede de testes `zkTanenbaum` está configurada para criar contas inteligentes, e o suporte de produção da zkSYS usa o mesmo modelo após a configuração dos endereços de produção da fábrica e dos módulos.

Outras chains EVM compatíveis podem usar os mesmos contratos. Quando a rede ativa tem suporte canônico a CREATE2, a Pali pode implantar a infraestrutura ausente das contas inteligentes dentro da própria carteira: abra Configurações, vá até Avançado e use o botão de implantação de **Configuração da conta inteligente**. Os validadores de passkeys precisam de suporte à verificação P-256 WebAuthn, que muitos ambientes EVM modernos oferecem por um pré-compilado de P-256/passkey.

### Configuração pendente

Uma configuração demorada mostra a ação **Verificar estado**. Sair da página ou mudar de rede não cancela uma transação já enviada. Volte à rede original e confira o estado da configuração antes de tentar outra implantação. Um tempo limite excedido ou uma resposta ausente não provam que nada foi implantado.

## Recuperação

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Tela de configurações de políticas de contas inteligentes da Pali" />
</a>
  <figcaption>A tela de políticas da conta inteligente mostra os módulos instalados, os detalhes do validador ativo, a recuperação por guardiões e o gerenciamento de módulos.</figcaption>
</figure>

Se os dados locais da carteira forem excluídos ou a Pali for instalada em um novo dispositivo, as contas inteligentes determinísticas da Pali poderão ser reconstruídas a partir dos metadados da carteira e da configuração da chain. Contas com validadores de passkey ainda precisam de acesso à credencial de passkey correspondente para aprovar ações.

Uma credencial de passkey pode controlar várias contas inteligentes. A Pali separa o perfil da credencial de passkey dos metadados de cada conta inteligente implantada.

## Recuperação por guardiões

A Pali usa guardiões de recuperação sob autocustódia para recuperar contas inteligentes. Um guardião é um endereço EVM que o usuário controla separadamente do validador ativo; normalmente é uma carteira EVM de backup, uma conta importada ou uma carteira de hardware, mas on-chain pode ser **qualquer conta capaz de comprovar uma assinatura**, incluindo uma conta de contrato. Enquanto a conta funciona normalmente, o usuário pode adicionar ou remover guardiões e atualizar o período de espera pela tela de políticas.

O módulo de recuperação verifica as aprovações dos guardiões com verificações padrão de assinatura: uma assinatura ECDSA comum para endereços normais, ou uma verificação de assinatura de contrato ERC-1271 quando o endereço do guardião é um contrato. Assim, um guardião pode ser outra conta inteligente, inclusive uma cuja política de assinatura seja um validador composto, personalizado ou futuro pós-quântico. O caminho de recuperação herda o esquema de assinatura imposto pela conta do guardião, de modo que sua segurança não se limita a chaves ECDSA clássicas.

Uma limitação atual: as telas de guardiões da Pali coletam aprovações de guardiões baseados em chaves, sejam contas da carteira, importadas ou de hardware. O módulo de recuperação implantado oferece suporte completo a guardiões de conta de contrato, mas produzir sua aprovação ERC-1271 ainda não é um fluxo guiado na Pali. Além disso, um guardião de contrato precisa estar implantado on-chain para responder às verificações de assinatura. Essa flexibilidade já faz parte do modelo da conta, permitindo disponibilizar esses tipos de guardião na carteira sem reimplantar ou alterar a conta.

A recuperação por guardiões não é instantânea. Iniciá-la cria um destino de recuperação substituto, solicita ao guardião configurado que assine a intenção de recuperação e envia uma solicitação com bloqueio temporal. Após o período de espera, qualquer pessoa pode finalizar a transação de recuperação. O usuário pode então operar a conta com o validador substituto.

A assinatura do guardião vincula a chain, o endereço da conta, o módulo de recuperação, o salt de recuperação, o modo de execução e os dados de chamada da recuperação. A Pali usa um salt novo em cada tentativa, e o módulo permite apenas uma recuperação ativa por conta.

Nota técnica: o executor de recuperação por guardiões armazena por conta um conjunto de guardiões, um limiar, um atraso, uma expiração e uma recuperação pendente. A Pali atualmente apresenta fluxos simples de guardiões para facilitar o uso, enquanto o módulo suporta políticas de limiar como 1-of-N ou M-of-N.

## Contas criadas por dapps

As dapps podem solicitar uma conta inteligente com `wallet_prepareSmartAccount`:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "p256-webauthn"
  }
}
```

As dapps também podem solicitar um validador ECDSA:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "ecdsa",
    "config": {
      "owners": ["0x..."],
      "threshold": 1
    }
  }
}
```

Se o proprietário ECDSA solicitado não for uma conta local da Pali, ela mostra um aviso e exige uma confirmação explícita antes de continuar.

## Referências de padrões

As contas inteligentes da Pali são baseadas em padrões públicos de contas inteligentes:

- [Abstração de contas ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) para execução de contas no estilo UserOperation.
- [Contas inteligentes modulares ERC-7579](https://eips.ethereum.org/EIPS/eip-7579) para módulos validadores e executores.
- [Validação de assinaturas de contrato ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) para assinaturas de contas de contrato.
- [WebAuthn Nível 3](https://www.w3.org/TR/webauthn-3/) para aprovações com passkeys.
