---
title: Privacidade e segurança
---

A Pali foi projetada para minimizar o que dapps podem aprender sem ação explícita do usuário.

## O que a Pali não expõe

A Pali não expõe seed phrases, chaves privadas, material privado de passkey, senhas da carteira ou listas irrestritas de contas a páginas web.

## O que dapps podem solicitar

Dapps podem solicitar endereços públicos de conta, estado do provider, estado de rede, assinaturas, aprovações de transação, assinatura PSBT, aprovações de observação de ativos, troca de chain, criação de conta inteligente e execução em lote.

## Segurança de conexão

Conecte-se apenas a dapps em que você confia. Uma dapp conectada pode ver a conta que você aprovou para aquela origem e pode solicitar ações futuras. Você pode revogar o acesso do site na carteira.

## Dados públicos da blockchain

A atividade na blockchain é pública. Seu endereço, histórico de transações, aprovações de token, atividade UTXO, implantação de smart account e atividade de smart account podem ficar visíveis em explorers e indexers.

## Provedores de serviços de rede

Os provedores RPC e Blockbook selecionados recebem os endereços das contas e as consultas ou transmissões de transações necessárias para suas ações. Consultas de contas UTXO podem incluir uma chave pública estendida (xpub). Serviços de descoberta de tokens, exploradores, preços, descoberta de redes e suporte de hardware recebem solicitações conforme a operação. Esses serviços também podem ver seu endereço IP e os horários das solicitações. Dapps conectadas recebem as contas públicas que você aprovar e as assinaturas que autorizar.

## Notas privadas

Este recurso usa quatro pools fixos de ETH do Tornado Classic (0,1, 1, 10 e 100 ETH) na rede principal Ethereum; ele não torna privada a atividade comum da carteira. Depósito e saque direto exigem uma conta HD de software ou importada capaz de assinar. Uma conta importada somente de observação pode fornecer contexto para saque por relayer; contas de hardware e smart accounts não são aceitas nessas operações. No saque direto, o pagador do gas e o destinatário ficam publicamente vinculados. Um relayer tem taxas e riscos de confiança próprios. Anonimato e privacidade pós-quântica não são garantidos.

Uma nota privada é um segredo ao portador: quem a tiver pode sacar. Enquanto a carteira estiver desbloqueada e você souber a senha, use **Revelar para backup** em cada nota salva e mantenha os backups secretos e seguros. A frase de recuperação sozinha não restaura notas geradas após recuperação, redefinição ou mudança de instalação.

O serviço de privacidade fornece dados públicos dos pools e o diretório de relayers; o RPC Ethereum selecionado e o endpoint do relayer escolhido são separados. O serviço padrão é `https://sysnode.info`. A configuração aceita uma origem HTTPS ou HTTP em `localhost` ou `127.0.0.1`, sem caminho, credenciais, consulta ou fragmento. Trocar de serviço limpa os dados públicos preparados e exige preparar o pool novamente; as notas salvas permanecem. Os provedores podem observar seu IP e os horários das solicitações.

O Pali pode usar o serviço de privacidade padrão ou seu próprio serviço Sysnode. Para executar seu serviço, consulte o [guia do Sysnode](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

O limite padrão é de 128 notas salvas (até 4 MiB). Em **Capacidade de notas**, você pode escolher 256 (até 8 MiB) ou 512 (até 16 MiB); limites maiores podem usar mais armazenamento local e tornar as operações do cofre mais lentas. O limite controla apenas quantas notas podem ser salvas. O armazenamento cresce com os dados; nenhum espaço é reservado antecipadamente e nenhuma nota é removida.

Use **Limpar notas concluídas** para verificar e remover notas concluídas. Um saque conhecido e qualquer depósito relacionado registrado devem estar finalizados; notas não verificadas permanecem salvas. O RPC Ethereum selecionado recebe o hash da transação de saque e, quando houver, o hash do depósito relacionado, permitindo que o provedor os vincule. A verificação depende das respostas desse RPC.

Você não pode reduzir o limite abaixo da quantidade de notas salvas. Uma nota marcada como gasta pode não ter o registro local de saque e o hash necessários para a limpeza; ela permanecerá salva. A verificação é feita uma nota por vez; se for interrompida, remoções anteriores podem já ter sido concluídas. Atualize a lista após um erro antes de tentar novamente.

## Privacidade de contas inteligentes

Os módulos e as execuções de contas inteligentes são públicos na blockchain. Se uma dapp solicitar a instalação de um proprietário ECDSA ou de um módulo de recuperação, revise os endereços dos proprietários e as configurações de recuperação antes de aprovar.
