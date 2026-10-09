---
title: Primeiros passos para usuários
---

A Pali permite gerenciar contas EVM, contas Syscoin UTXO e contas inteligentes modulares em uma única extensão.

## Configuração básica

1. Instale a extensão Pali.
2. Crie uma nova carteira ou importe uma seed phrase existente.
3. Defina uma senha forte.
4. Faça backup da sua seed phrase offline.
5. Escolha a rede que deseja usar.
6. Conecte-se apenas a dapps em que você confia.

## Configuração e carregamento

Mantenha a configuração inacabada aberta e visível. Sair dela, ocultá-la ou recarregá-la limpa os dados sensíveis inseridos e pode exigir que você recomece. Guarde a seed phrase da qual fez backup.

Se a Pali não conseguir confirmar que a criação da carteira terminou, deixe-a recarregar e verificar a carteira. Se aparecer uma tela de desbloqueio, use a senha que acabou de definir. Não presuma que uma resposta interrompida significa que nenhuma carteira foi criada, nem repita a criação imediatamente.

Durante uma operação lenta, a Pali pode mostrar opções de recuperação e manter a navegação disponível. As ações sensíveis ainda aguardam a conta e a rede se estabilizarem. Receber oculta temporariamente o endereço, o código QR e o controle de cópia; as solicitações ao faucet também aguardam. Confira novamente a conta e a rede antes de continuar.

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

## Contas inteligentes

Contas inteligentes são contas de contrato controladas por módulos. A Pali pode criar contas controladas por um validador de passkey, um validador ECDSA da carteira ou uma política de gestão compartilhada. Elas são úteis para a integração com dapps, ações em lote e recuperação por guardiões. Algumas contas inteligentes são contrafactuais até sua primeira transação de implantação.
