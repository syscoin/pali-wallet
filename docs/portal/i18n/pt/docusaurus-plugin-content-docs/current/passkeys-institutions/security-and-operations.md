---
title: Segurança e operações
---

Integrações institucionais de passkey devem ser projetadas como infraestrutura de conta em produção, não apenas como um botão de login.

## Dependência de rede e verificador

Contas com passkey dependem do suporte da zkSYS para verificar assinaturas WebAuthn P-256. Não presuma que uma conta com passkey pode ser criada em qualquer chain EVM só porque a chain oferece suporte a smart contracts. A chain deve ter a fábrica de passkey implantada e a Pali deve ter o endereço dessa fábrica configurado para a chain ativa.

Hoje, a implantação de teste configurada da Pali é `zkTanenbaum` (`57057`). Trate a produção da zkSYS como o alvo de implantação em produção para a mesma arquitetura assim que sua fábrica estiver configurada na carteira.

## Checklist operacional

- Decida se cada usuário recebe uma conta com passkey compartilhada da Pali ou uma credencial separada.
- Decida se sponsorship é desabilitado, somente gas ou obrigatório.
- Mantenha uptime do serviço de sponsor se usar modo `required`.
- Monitore falhas de relayer, deadlines expirados e chaves de idempotência repetidas.
- Forneça um caminho de suporte ao usuário para dispositivos perdidos e recuperação com falha.
- Documente se a instituição pode coautorizar execução.

## Funding e implantação

Smart accounts com passkey podem ser contrafactuais antes do primeiro uso. A primeira execução pode precisar de um pagador de gas de implantação ou caminho de sponsor. Seu fluxo de onboarding deve explicar se os usuários precisam financiar a conta antes de usá-la.

A fábrica pode calcular o endereço da conta antes da implantação. Isso é útil para onboarding porque uma dapp ou instituição pode exibir ou financiar o endereço antes da primeira transação on-chain.

## Premissas de recuperação

A recuperação é escopada à carteira e à passkey. Um usuário geralmente precisa de:

- o contexto restaurado da Pali Wallet
- a credencial WebAuthn relevante
- suporte da chain à fábrica de passkey

A recuperação não é uma backdoor custodial. A chain fornece metadados públicos descobríveis e listas de contas, mas o usuário ainda precisa do contexto de recuperação da carteira e da credencial WebAuthn relevante para provar controle.

## Status de backup da credencial

A Pali pode expor status de backup da credencial WebAuthn quando o navegador e o authenticator o expõem. Trate isso como sinal operacional, não como regra de segurança on-chain.

O status de backup pode indicar se uma credencial parece vinculada a dispositivo, elegível para backup ou atualmente em backup/sincronizada pelo provedor de passkey de plataforma. Uma passkey sincronizada pode melhorar a conveniência e a recuperação em caso de perda de dispositivo porque o usuário pode restaurar a credencial por meio da conta Apple, Google, Microsoft ou outra conta de plataforma. O compromisso é que o limite efetivo de segurança agora inclui essa conta de plataforma, seu processo de recuperação e quaisquer dispositivos onde a passkey esteja sincronizada.

| Status da credencial | Implicação para política institucional | Experiência do usuário | Limite de risco |
| --- | --- | --- | --- |
| Em backup ou sincronizada | Aceite quando recuperação de conta e conveniência de onboarding importam mais do que isolamento estrito de dispositivo. | Melhor experiência de substituição de dispositivo e múltiplos dispositivos. Muitas vezes é o padrão da plataforma para passkeys de consumo. | A confiança se estende à conta de plataforma, ao fluxo de recuperação da plataforma e aos dispositivos sincronizados. |
| Elegível para backup | Decida se a elegibilidade por si só é aceitável, porque a credencial pode se tornar sincronizada depois. | Flexível, mas usuários podem não entender se a sincronização está ativa. | Exige orientação clara ao usuário e revisão periódica de status se o valor da conta mudar. |
| Vinculada a dispositivo ou sem backup | Prefira para contas de alto valor, tesouraria, admin ou estilo cold. | Mais atrito e mais carga de suporte se o dispositivo for perdido. | Isolamento mais forte a um authenticator ou chave de hardware específico. |
| Desconhecido ou indisponível | Evite para decisões de política de alta garantia, a menos que você tenha controles de authenticator fora de banda. | O usuário pode prosseguir, mas a instituição não consegue classificar a credencial com confiança. | Ambíguo; não trate como prova de backup em nuvem nem como prova de isolamento vinculado a dispositivo. |

Para contas institucionais de maior garantia, decida e documente se passkeys sincronizadas são aceitáveis. Passkeys sincronizadas ainda são seguras para uso comum de carteira e dapp porque a Pali e a dapp nunca recebem a chave privada da passkey, WebAuthn permanece vinculado à origem, e o authenticator da plataforma ainda realiza verificação do usuário. Elas simplesmente não são o padrão correto para cold storage, controles de tesouraria ou grandes saldos de longo prazo, a menos que a instituição aceite explicitamente o limite de recuperação da conta de plataforma.

## Comunicação com o usuário

Use texto de política claro. Uma boa política explica:

- quem opera o serviço de sponsor
- quais ações exigem coautorização
- se a instituição paga gas
- o que acontece se o serviço de sponsor estiver indisponível

## Não dependa do texto de política para enforcement

`policyText` é um campo de divulgação e metadados da carteira. O enforcement ocorre por meio de política on-chain e validação de prova de sponsor.
