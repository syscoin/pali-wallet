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

## O que torna a Pali diferente?

A Pali é construída em torno de uma ideia: a carteira deve ser a fronteira de segurança do usuário, não um servidor. A Pali pode ler de nós RPC, explorers e indexadores como qualquer carteira de navegador, mas custódia, aprovações, recuperação e política de conta permanecem com as chaves do usuário e módulos on-chain.

- **Sem servidor de custódia ou recuperação.** A Pali não guarda chave do lado do servidor, dados criptografados na nuvem, motor de políticas ou backdoor de recuperação. Ações sensíveis são aprovadas na extensão, assinadas pela carteira, passkey, dispositivo de hardware ou validador da smart account do usuário, e aplicadas pela chain.
- **Leituras rápidas com fallbacks seguros.** Quando a Pali precisa de muitas leituras de contratos EVM, ela tenta primeiro Multicall3 `aggregate3`: um `eth_call` on-chain, uma visão do mesmo bloco e isolamento de falha por chamada. Se Multicall3 não estiver implantado ou o RPC rejeitar, a Pali usa batch JSON-RPC; se batch não estiver disponível, volta para chamadas individuais.
- **Duas famílias de chains em uma carteira.** A Pali expõe `window.ethereum` compatível com MetaMask para dapps EVM e `window.pali` para fluxos Syscoin UTXO / estilo Bitcoin. Uma dapp pode trabalhar com ativos baseados em conta, UTXOs, PSBTs e xpubs em uma única extensão.
- **Contas comuns e smart accounts.** Usuários podem manter contas estilo EOA, contas de hardware wallet e smart accounts Pali lado a lado. Contas comuns são simples e portáveis. Smart accounts adicionam política programável: passkeys, validadores ECDSA controlados pela carteira, políticas de threshold composite, guardian recovery e módulos personalizados.
- **Integração dapp baseada em padrões.** A Pali segue as APIs de carteira que dapps já usam: EIP-1193, EIP-6963, permissões EIP-2255, EIP-5792 `wallet_sendCalls`, dados tipados EIP-712 e comportamento compatível com MetaMask. Smart accounts Pali usam módulos validador/executor estilo ERC-7579 e dados de execução estilo ERC-4337.
- **Autorização programável.** Em uma smart account Pali, o endereço é estável, mas a política de assinatura pode evoluir. Um validador decide quem pode aprovar ações; um executor adiciona recursos como guardian recovery. Assim, uma equipe pode sair de uma passkey para uma política de threshold, adicionar recuperação ou adotar novos tipos de validadores sem mover fundos.
- **Projetada para assinaturas futuras mais fortes.** Como a autorização é modular, validadores futuros podem suportar esquemas além de ECDSA e passkeys P-256, incluindo designs pós-quânticos quando forem práticos para a chain alvo.
- **Segurança antes da conveniência.** A Pali serializa aprovações bloqueantes, verifica sites conectados e contexto de rede, bloqueia hits de blacklist de alto risco para envios e aprovações, e mantém guardian recovery separada da assinatura de transações. Guardiões podem ajudar a recuperar acesso após um atraso; eles não podem gastar fundos silenciosamente.

A direção da Pali é **contas programáveis autocustodiais para usuários reais e dapps reais**: rápidas o suficiente para o uso diário, padronizadas o suficiente para desenvolvedores, flexíveis o suficiente para instituições e conservadoras o suficiente para manter o controle crítico de segurança com o usuário e a chain.

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
