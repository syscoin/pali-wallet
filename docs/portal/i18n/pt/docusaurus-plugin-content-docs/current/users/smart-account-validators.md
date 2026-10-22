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

A Pali oferece estes tipos de validadores:

- **Passkey:** o navegador ou o sistema operacional solicita uma aprovação WebAuthn.
- **ECDSA:** os endereços EVM dos proprietários configurados aprovam as ações da conta.
- **SLH-DSA:** o assinador pós-quântico local da Pali aprova ações usando seu estado de assinatura criptografado. Consulte [Assinador pós-quântico](./post-quantum-signer) para conhecer as limitações de backup e do contador de assinaturas.
- **Composto:** validadores filhos são combinados sob um limiar, como passkey ou ECDSA.

Pense nos validadores como a resposta à pergunta “quem pode aprovar ações desta conta?”. A parte útil é que a resposta pode mudar sem mudar a sua conta:

- **Uma aprovação** (1-of-N): um validador filho configurado deve aprovar.
- **Um limiar de aprovações** (t-of-N): pelo menos o número configurado de validadores filhos deve aprovar.
- **Todas as aprovações** (N-of-N): todos os validadores filhos configurados devem aprovar.

A Pali coleta as aprovações dos validadores filhos integrados disponíveis localmente, na ordem configurada na política, até atingir o limiar. Recusar uma aprovação interrompe a solicitação; a Pali não troca silenciosamente de assinador após uma recusa. Uma política precisa manter validadores filhos integrados suficientes para assinar localmente e atingir seu limiar. Validadores personalizados compatíveis podem ser filhos opcionais, mas a Pali não coleta assinaturas externas ou personalizadas nem aprovações entre dispositivos para eles. Esta versão não oferece suporte a políticas compostas aninhadas.

O construtor de políticas compostas exige pelo menos dois validadores instalados. O fluxo guiado de troca do método de aprovação substitui o validador anterior. O fluxo avançado atual **Validador personalizado** permite manter validadores compatíveis adicionais, mas exige os dados corretos de inicialização do módulo; não é uma configuração simples de aprovações entre dispositivos.

Mudar o validador não altera o endereço, os saldos nem o histórico da conta inteligente. O acesso a um assinador local ainda depende da disponibilidade da chave ou passkey; mudar a política não restaura o estado de assinatura perdido nem coordena o uso de SLH-DSA entre dispositivos restaurados.

Os guardiões são uma autoridade separada e adiada, não o método de aprovação cotidiano. Um número suficiente de aprovações de guardiões pode mudar o controle da conta. Escolha e proteja os guardiões de acordo com isso: o prazo de espera não torna seguro um guardião não confiável.

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
  <figcaption>As configurações da conta inteligente começam pelo registro se ela ainda não foi implantada. Após o registro, aqui ficam as opções de aprovação e recuperação.</figcaption>
</figure>

Se os dados locais da carteira forem excluídos ou a Pali for instalada em um novo dispositivo, as contas inteligentes determinísticas da Pali poderão ser reconstruídas a partir dos metadados da carteira e da configuração da chain. Contas com validadores de passkey ainda precisam de acesso à credencial de passkey correspondente para aprovar ações.

Uma credencial de passkey pode controlar várias contas inteligentes. A Pali separa o perfil da credencial de passkey dos metadados de cada conta inteligente implantada.

## Recuperação por guardiões

A Pali usa guardiões de recuperação sob autocustódia para recuperar contas inteligentes. Um guardião é um endereço EVM que o usuário controla separadamente do validador ativo; normalmente é uma carteira EVM de backup, uma conta importada ou uma carteira de hardware, mas on-chain pode ser **qualquer conta capaz de comprovar uma assinatura**, incluindo uma conta de contrato. Enquanto a conta funciona normalmente, o usuário pode adicionar ou remover guardiões e atualizar o período de espera pela tela de políticas.

O módulo de recuperação verifica as aprovações dos guardiões com verificações padrão de assinatura: uma assinatura ECDSA comum para endereços normais, ou uma verificação de assinatura de contrato ERC-1271 quando o endereço do guardião é um contrato. Assim, um guardião pode ser outra conta inteligente, inclusive uma cuja política de assinatura seja um validador composto, personalizado ou futuro pós-quântico. O caminho de recuperação herda o esquema de assinatura imposto pela conta do guardião, de modo que sua segurança não se limita a chaves ECDSA clássicas.

As telas de guardiões da Pali podem coletar aprovações de guardiões locais baseados em chaves (contas da carteira, importadas ou de hardware) e de contas inteligentes locais para as quais a Pali pode assinar, incluindo contas SLH-DSA. Um guardião de conta inteligente já deve estar implantado on-chain para responder às verificações de assinatura ERC-1271. Um guardião externo que não esteja disponível como conta de assinatura local na Pali ainda precisa de um fluxo externo de recuperação para produzir sua aprovação.

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

## Recuperação com guardiões passo a passo {#guardian-recovery-guide}

Restaurar registros locais da carteira é diferente de mudar o controle da conta. Restaurar a seed não contorna um validador instalado. A recuperação com guardiões muda, após uma espera, o método de aprovação da mesma conta inteligente.

1. **Configurar:** Abra as configurações de recuperação enquanto o método de aprovação atual funcionar. Registre primeiro a conta se ainda não estiver implantada. Escolha um guardião controlado separadamente e um prazo, e confirme a configuração on-chain. Mantenha o pagador do gas financiado.
2. **Iniciar:** Se perder acesso, escolha um novo método de aprovação cujo controle possa comprovar. O guardião configurado assina a intenção exata de recuperação. O envio custa gas; ainda não muda o controle.
3. **Esperar e concluir:** O método anterior continua ativo até a recuperação ser concluída com sucesso. Volte à mesma conta e rede após a espera. Após a espera, qualquer pessoa pode enviar a conclusão da recuperação exata já aprovada pelos guardiões, antes de expirar. Depois, o método novo controla a mesma conta; endereço, fundos e histórico permanecem.

Após a conclusão, o método ativo substituído não autoriza mais essa conta. Não apague chaves ou passkeys antigas antes de verificar se outras contas e redes ainda precisam delas. Uma solicitação que expira antes da conclusão exige nova tentativa.

Novas políticas da Pali oferecem **3 ou 7 dias** de espera. **10 minutos** é restrito a testnets conhecidas. São opções de configuração da Pali, não um mínimo imposto a todo o contrato. As configurações on-chain existentes continuam sendo a referência. A espera é diferente da janela posterior em que a recuperação pode ser concluída.

### Parar uma recuperação inesperada

Se ainda controla o método de aprovação atual, escolha **Disable guardian recovery** (desativar recuperação com guardiões) nas configurações de recuperação. Confira conta e rede, confirme e pague o gas. A remoção confirmada invalida todas as recuperações pendentes, inclusive as iniciadas fora desta carteira, e remove essa via. Configure novamente guardiões confiáveis se quiser continuar usando-a.

A remoção deve ser confirmada antes da conclusão indesejada; não desfaz uma recuperação já concluída. Se o resultado for incerto, confira primeiro o estado on-chain. Erro, timeout ou fechar a janela não cancela uma transação enviada. Não a reenvie às cegas.

### Alertas opcionais por e-mail

O link nas configurações abre **Sysnode Account → Recovery alerts**. Use um e-mail verificado, conecte a conta inteligente implantada em uma rede compatível e assine a inscrição com o método de aprovação atual. Confira se o monitoramento está ativo. Isso é opcional e separado da configuração dos guardiões; a Sysnode não recebe chaves privadas nem pode mover fundos ou cancelar a recuperação.

O monitoramento continua com a Pali fechada, mas depende do serviço, do RPC e da entrega dos e-mails. Alertas podem atrasar ou falhar, e observações recentes da cadeia podem sofrer reorganização. A ausência de e-mail não prova que não existe recuperação. Revise alertas na carteira confiável para a conta e rede exatas.
