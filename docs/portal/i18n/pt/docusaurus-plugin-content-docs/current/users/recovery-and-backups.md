---
title: Recuperação e backups
---

Backups importam porque a Pali é não custodial. A carteira não pode recuperar uma seed phrase, senha, chave privada ou segredo do authenticator de passkey para você.

## Backup da seed phrase

Anote a seed phrase da sua carteira e mantenha-a offline. Qualquer pessoa com a seed phrase pode controlar as contas derivadas.

## Desbloqueio e alterações de passkey

Um serviço do navegador indisponível, um problema de armazenamento ou um recurso criptográfico sem suporte podem impedir o desbloqueio sem que a senha esteja errada. Leia o erro, restabeleça o serviço ou a conexão necessários e tente desbloquear novamente. Não exclua nem reimporte a carteira para contornar um erro operacional. Erros operacionais não contam como tentativas de senha malsucedidas.

Ao substituir uma passkey, tanto a credencial anterior quanto a nova podem continuar disponíveis. A anterior ainda pode controlar outra chain ou uma política compartilhada. Não exclua nenhuma delas apenas porque a configuração foi cancelada ou falhou; primeiro confirme quais credenciais as contas envolvidas ainda exigem. Preserve os dados atuais da carteira enquanto investiga uma alteração interrompida.

## Status de backup de passkey

Passkeys podem estar vinculadas a um dispositivo ou sincronizadas pelo provedor da conta de plataforma. A Pali expõe status relacionado a backup quando disponível, mas o comportamento exato depende do authenticator, navegador e sistema operacional.

Você pode ver status que sugere se uma passkey está vinculada a dispositivo, é elegível para backup ou está em backup/sincronizada. Uma passkey sincronizada costuma ser mais conveniente porque pode acompanhar você por meio de uma conta de plataforma como Apple, Google ou Microsoft. Uma passkey vinculada a dispositivo ou chave de segurança de hardware pode ser mais rigorosa, mas perder esse dispositivo pode tornar a recuperação mais difícil.

| Status que você pode ver | O que significa | Conveniência | Compromisso de segurança | Bom encaixe |
| --- | --- | --- | --- | --- |
| Em backup ou sincronizada | A passkey parece estar armazenada por um provedor de passkey de plataforma e pode sincronizar para outros dispositivos confiáveis. | Maior. Muitas vezes você pode recuperar após substituir um telefone ou laptop ao entrar novamente na conta de plataforma. | O segredo da passkey ainda é protegido pelo sistema de passkey da plataforma, mas o limite de segurança inclui a conta de plataforma, o processo de recuperação da conta e dispositivos sincronizados. | Carteiras do dia a dia, contas de dapp, onboarding institucional e saldos menores. |
| Elegível para backup | O authenticator diz que a passkey pode receber backup ou ser sincronizada, mas talvez não esteja sincronizada no momento. | Média a alta, dependendo de a sincronização estar habilitada. | Configurações futuras da plataforma podem mover a credencial para sincronização em nuvem. Revise as configurações do provedor e do dispositivo se isso for importante para você. | Usuários que querem flexibilidade de recuperação, mas ainda querem inspecionar se a sincronização está ativa. |
| Vinculada a dispositivo ou sem backup | A passkey parece vinculada a um authenticator ou dispositivo. | Menor. Se o dispositivo for perdido e não existir outro caminho de recuperação, a recuperação pode ser mais difícil ou impossível. | Isolamento mais forte porque o controle fica concentrado nesse authenticator em vez de uma conta sincronizada em nuvem. | Saldos maiores, contas de maior segurança, chaves de segurança de hardware e uso em estilo cold wallet. |
| Desconhecido ou indisponível | O navegador, OS ou authenticator não expôs informações de backup suficientes. | Desconhecida. | Não presuma recuperação em nuvem nem isolamento vinculado a dispositivo. Trate como ambíguo até verificar a configuração do authenticator. | Uso temporário, testes ou casos em que você pode verificar independentemente o provedor de passkey. |

Passkeys sincronizadas em nuvem ainda são seguras para uso normal: a chave privada não é entregue à Pali nem à dapp, WebAuthn permanece vinculado à origem, e a verificação do usuário ainda é realizada pelo authenticator da plataforma. O compromisso é que a conta de plataforma passa a fazer parte do modelo de segurança da sua carteira. Para cold storage, fundos de tesouraria ou grandes saldos de longo prazo, prefira um authenticator vinculado a dispositivo ou uma chave de segurança de hardware e mantenha apenas fundos operacionais menores em contas com passkey sincronizada.

O status de backup é um sinal para ajudar você a escolher entre conveniência e segurança. Ele não substitui o backup da sua seed phrase e não significa que a Pali ou uma instituição possa recuperar um segredo de passkey para você.

## Recuperar contas inteligentes

A recuperação de contas inteligentes da Pali depende dos módulos instalados. Uma conta controlada por passkey precisa da credencial WebAuthn correspondente para aprovar ações futuras. Um módulo de recuperação por guardiões pode substituir o validador ativo após o bloqueio temporal configurado se o número exigido de guardiões assinar a intenção de recuperação. O fluxo de recuperação pode:

1. Reconstruir registros determinísticos de contas Pali a partir dos metadados da carteira.
2. Solicitar uma asserção WebAuthn quando um validador de passkey precisar comprovar o controle.
3. Usar a recuperação por guardiões quando for necessário substituir o validador ativo.
4. Ignorar contas que já estão na carteira.
5. Mostrar contas recuperáveis com indicações de saldo e atividade, quando disponíveis.
6. Importar as contas selecionadas pelo usuário.

## Criação por dapps e recuperação da carteira

Quando uma dapp chama `wallet_prepareSmartAccount`, a Pali cria uma conta inteligente e salva metadados duráveis localmente após a conclusão da implantação e de qualquer configuração de validador solicitada. A Pali também mantém registros locais da configuração pendente de passkeys antes da instalação, para que uma alteração interrompida não descarte silenciosamente esses detalhes de recuperação. Esses registros não substituem o backup da seed phrase nem o acesso à passkey.

Se uma conta inteligente existe on-chain, mas está ausente localmente, use o fluxo de recuperação da carteira da Pali. A Pali ignora as contas já presentes e permite que o usuário escolha quais das restantes deseja importar.
