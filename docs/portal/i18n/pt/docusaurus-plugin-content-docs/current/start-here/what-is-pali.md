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
