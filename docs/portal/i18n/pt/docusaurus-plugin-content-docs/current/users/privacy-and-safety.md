---
title: Privacidade e segurança
---

A Pali foi projetada para minimizar o que dapps podem aprender sem ação explícita do usuário.

## O que a Pali não expõe

A Pali não expõe seed phrases, chaves privadas, material privado de passkey, senhas da carteira ou listas irrestritas de contas a páginas web.

## O que dapps podem solicitar

Dapps podem solicitar endereços públicos de conta, estado do provider, estado de rede, assinaturas, aprovações de transação, assinatura PSBT, aprovações de observação de ativos, troca de chain, criação de conta com passkey e execução em lote.

## Segurança de conexão

Conecte-se apenas a dapps em que você confia. Uma dapp conectada pode ver a conta que você aprovou para aquela origem e pode solicitar ações futuras. Você pode revogar o acesso do site na carteira.

## Dados públicos da blockchain

A atividade na blockchain é pública. Seu endereço, histórico de transações, aprovações de token, atividade UTXO, implantação de smart account e atividade de smart account com passkey podem ficar visíveis em explorers e indexers.

## Privacidade de passkey institucional

Se uma dapp ou instituição fornece uma URL de sponsor, esse serviço pode receber solicitações de sponsor relacionadas à execução da conta. Revise o texto da política da instituição e a URL antes de aprovar.

## Notas privadas

O Pali pode usar o serviço de privacidade padrão ou seu próprio serviço Sysnode. Para executar seu serviço, consulte o [guia do Sysnode](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

O limite padrão é de 128 notas salvas (até 4 MiB). Em **Capacidade de notas**, você pode escolher 256 (até 8 MiB) ou 512 (até 16 MiB); limites maiores podem usar mais armazenamento local e tornar as operações do cofre mais lentas. Alterar o limite não remove notas, mas versões antigas da carteira talvez não consigam ler o formato atualizado.

Use **Limpar notas concluídas** para verificar e remover notas concluídas. Um saque conhecido e qualquer depósito relacionado registrado devem estar finalizados; notas não verificadas permanecem salvas. O RPC Ethereum selecionado recebe o hash da transação de saque e, quando houver, o hash do depósito relacionado, permitindo que o provedor os vincule. A verificação depende das respostas desse RPC.
