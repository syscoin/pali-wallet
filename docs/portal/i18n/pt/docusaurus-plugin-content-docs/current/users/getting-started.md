---
title: Primeiros passos para usuários
---

A Pali permite gerenciar contas EVM, contas Syscoin UTXO e smart accounts com passkey a partir de uma única extensão.

## Configuração básica

1. Instale a extensão Pali.
2. Crie uma nova carteira ou importe uma seed phrase existente.
3. Defina uma senha forte.
4. Faça backup da sua seed phrase offline.
5. Escolha a rede que deseja usar.
6. Conecte-se apenas a dapps em que você confia.

## Conectar a uma dapp

Quando um site solicita acesso, a Pali abre um popup de conexão que mostra o site e permite escolher a conta. Uma dapp recebe apenas o endereço da conta conectada e o estado aprovado do provider.

A Pali armazena conexões por site. Você pode conectar sites diferentes a contas diferentes, mas cada site tem uma conta ativa por vez.

## Contas EVM

Use contas EVM para chains compatíveis com Ethereum, Rollux, Syscoin NEVM e dapps que esperam comportamento de carteira no estilo MetaMask.

Dapps EVM podem solicitar:

- acesso à conta
- transações
- assinaturas pessoais
- assinaturas de dados tipados
- solicitações de observação de token
- solicitações de adicionar/trocar chain
- solicitações de chamadas em lote

## Contas UTXO

Use contas UTXO para fluxos de transação Syscoin UTXO e no estilo Bitcoin. Dapps UTXO podem solicitar estado ciente de xpub, endereços de troco, assinatura PSBT e broadcast de transação.

## Smart accounts com passkey

Contas com passkey são smart accounts controladas por credenciais WebAuthn. Elas podem ser úteis para onboarding gerenciado por instituições, recuperação de conta e execução patrocinada. Algumas contas com passkey são contrafactuais até sua primeira transação de implantação.
