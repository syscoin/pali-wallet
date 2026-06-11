---
title: O que é a Pali?
---

A Pali Wallet é a extensão oficial de carteira da Syscoin e uma carteira web3 de uso geral para chains compatíveis com EVM. Ela foi projetada para três públicos sobrepostos:

- **Usuários comuns** que querem uma carteira de navegador segura para EVM, Syscoin, Rollux e ativos UTXO.
- **Desenvolvedores de dapps** que querem acesso EVM compatível com MetaMask e acesso UTXO na mesma extensão.
- **Instituições** que querem smart accounts com passkey, recuperação de conta, política de módulos e onboarding orientado por dapp.

## O que torna a Pali diferente

A maioria das carteiras de navegador expõe apenas um provider EVM. A Pali expõe duas superfícies complementares:

- `window.ethereum` para dapps EVM, intencionalmente compatível com fluxos comuns da MetaMask.
- `window.pali` para fluxos Syscoin UTXO e no estilo Bitcoin.

Isso permite que uma dapp construa experiências que atravessam chains baseadas em contas e baseadas em UTXO sem pedir que os usuários instalem carteiras diferentes.

## O que há de novo na Pali v4

A Pali v4 é uma modernização completa da carteira em torno de três ideias: velocidade, padrões e autoridade de assinatura flexível.

- **Mais rápida em tudo.** A Pali agrupa o tráfego RPC em lotes nas redes EVM e UTXO, então saldos, histórico e dados de taxas carregam com muito menos idas e voltas. O resultado é uma carteira que parece instantânea em vez de ocupada.
- **Smart accounts baseadas em padrões.** As smart accounts da Pali seguem o modelo de módulos ERC-7579 com codificação de execução no estilo ERC-4337. Nada na conta é aprisionamento proprietário: validadores, executores e o comportamento da conta seguem especificações públicas.
- **A autorização é separada da conta.** Quem pode assinar é uma decisão de módulo, não uma propriedade gravada no endereço. Hoje isso significa chaves ECDSA controladas pela carteira e passkeys P-256 WebAuthn. Amanhã pode significar novos tipos de validador — incluindo esquemas de assinatura pós-quânticos — instalados na mesma conta, no mesmo endereço, sem nenhum ECDSA envolvido na autorização de cada transação.
- **Políticas de assinatura componíveis.** Um validador composite combina validadores filhos sob um threshold: 1-of-N para conveniência, t-of-N para controle compartilhado, N-of-N para máxima garantia. Composites podem ser aninhados, então as políticas podem ser hierárquicas.
- **Guardiões protegem contra perda de acesso.** Guardian recovery é um módulo separado com papel de executor (conforme o ERC-7579), deliberadamente distinto dos validadores. Guardiões não podem assinar transações; eles só podem agendar uma substituição de validador com espera. Adicione ou remova guardiões a qualquer momento enquanto a conta estiver saudável.

## Para onde a Pali está indo

A direção da Pali é **autoridade de assinatura dinâmica e flexível para frontends de cripto**. Qualquer frontend — uma dapp, uma exchange, um painel institucional, um serviço embarcado — deve poder pedir à carteira exatamente a política de assinatura que o trabalho exige: um passkey para onboarding sem atrito, um composite t-of-N para uma tesouraria compartilhada, um guardião apoiado por hardware para recuperação, ou um tipo de validador futuro que ainda não existe. O endereço da conta permanece estável enquanto a autoridade por trás dele evolui.

## Compatibilidade em resumo

| Capacidade | Superfície compatível |
| --- | --- |
| Solicitações de provider EIP-1193 | `window.ethereum` |
| Descoberta de carteira EIP-6963 | anúncio de provider `window.ethereum` |
| Permissões de conta | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Transações e assinaturas EVM | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, métodos de assinatura relacionados |
| Solicitações em lote EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities` |
| Estado de conta UTXO e xpub | `window.pali` e métodos `sys_*` |
| Assinatura e broadcast de PSBT | `sys_sign`, `sys_signAndSend` |
| Criação de smart account com passkey | `wallet_prepareSmartAccount` |

## Escopo atual de passkey

As smart accounts da Pali estão disponíveis em redes EVM onde a factory e os módulos da Pali existem nos endereços usados pela Pali. Esta build da Pali configura a testnet `zkTanenbaum` (`57057`), e o suporte de produção da zkSYS usa a mesma arquitetura assim que os endereços de produção estiverem configurados.

A infraestrutura não é limitada a chains operadas pela Pali. Em redes EVM compatíveis com suporte CREATE2 canônico, a Pali pode implantar a configuração de smart account necessária diretamente pela carteira: abra Pali Settings, vá para Advanced e use o botão Deploy em **Smart account setup**. Validadores passkey precisam de verificação P-256 WebAuthn, geralmente fornecida por um precompile P-256/passkey.
