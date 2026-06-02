---
title: Boas-vindas à Pali Wallet
slug: /
---

A Pali Wallet é uma carteira em extensão de navegador para pessoas e aplicações que precisam de acesso a blockchains baseadas em contas e baseadas em UTXO a partir de uma única camada de segurança.

Para dapps EVM, a Pali expõe um provider `window.ethereum` compatível com MetaMask, com solicitações EIP-1193, descoberta EIP-6963, permissões de conta, troca de chain, assinatura, transações e chamadas em lote. Para aplicações Syscoin UTXO e no estilo Bitcoin, a Pali expõe `window.pali` com métodos de conta, xpub, endereço de troco, assinatura PSBT, transação e ativos.

A Pali também oferece suporte a smart accounts com passkey para instituições e dapps avançadas. Uma dapp pode pedir à Pali para criar ou recuperar uma smart account apoiada por WebAuthn, anexar uma política de sponsor e depois executar lotes atômicos por meio de `wallet_sendCalls`.

## Escolha seu caminho

- **Usuários** devem começar por [Primeiros passos](./users/getting-started.md).
- **Desenvolvedores EVM** devem começar por [Descoberta de provider](./developers/provider-discovery.md) e [Visão geral da API EVM](./evm-api/overview.md).
- **Desenvolvedores UTXO e Syscoin** devem começar por [Visão geral da API UTXO e Syscoin](./utxo-syscoin-api/overview.md).
- **Instituições que usam passkeys** devem começar por [Passkeys e instituições](./passkeys-institutions/overview.md).

## Superfícies de provider

| Provider | Família de chain | Uso principal |
| --- | --- | --- |
| `window.ethereum` | EVM | Integrações de dapps compatíveis com MetaMask, assinatura, transações, permissões e lotes EIP-5792. |
| `window.pali` | UTXO / Syscoin | Contas Syscoin UTXO, assinatura PSBT, fluxos de xpub/endereço de troco e auxiliares de ativos. |

## Modelo de segurança importante

A Pali é intencionalmente conservadora. Dapps se conectam por host, aprovações bloqueantes são serializadas, incompatibilidades de tipo de rede são tratadas explicitamente, e usuários aprovam ações sensíveis na UI da extensão. Muitos sites podem estar conectados, mas cada site tem uma conta conectada ativa por vez.
