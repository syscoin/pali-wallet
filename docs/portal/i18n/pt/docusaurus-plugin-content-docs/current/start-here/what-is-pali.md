---
title: O que é a Pali?
---

A Pali Wallet é a extensão oficial de carteira da Syscoin e uma carteira web3 de uso geral para chains compatíveis com EVM. Ela foi projetada para três públicos sobrepostos:

- **Usuários comuns** que querem uma carteira de navegador segura para EVM, Syscoin, Rollux e ativos UTXO.
- **Desenvolvedores de dapps** que querem acesso EVM compatível com MetaMask e acesso UTXO na mesma extensão.
- **Instituições** que querem smart accounts com passkey, recuperação de conta, política de sponsor e onboarding orientado por dapp.

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
| Criação de smart account com passkey | `wallet_createPasskeyAccount` |

## Escopo atual de passkey

Smart accounts com passkey estão disponíveis apenas em redes EVM da família zkSYS onde a Pali configurou os contratos de fábrica de passkey e a chain oferece suporte à verificação de provas WebAuthn P-256. Esta build da Pali configura a testnet `zkTanenbaum` (`57057`). O suporte de produção da zkSYS usa a mesma arquitetura assim que o endereço da fábrica de produção estiver configurado na Pali. Dapps devem verificar capacidades e tratar chains sem suporte de forma limpa.
