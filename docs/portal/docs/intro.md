---
title: Welcome to Pali Wallet
slug: /
---

Pali Wallet is a browser extension wallet for people and applications that need both account-based and UTXO-based blockchain access from one security layer.

For EVM dapps, Pali exposes a MetaMask-compatible `window.ethereum` provider with EIP-1193 requests, EIP-6963 discovery, account permissions, chain switching, signing, transactions, and batch calls. For Syscoin UTXO and Bitcoin-style applications, Pali exposes `window.pali` with account, xpub, change address, PSBT signing, transaction, and asset methods.

Pali also supports modular smart accounts for institutions and advanced dapps. A dapp can ask Pali to create and deploy a Pali smart account, use a passkey or wallet-owned ECDSA validator, and later execute atomic batches through `wallet_sendCalls`. Guardian recovery and module management are handled in Pali.

## Choose your path

- **Users** should start with [Getting started](./users/getting-started.md).
- **EVM developers** should start with [Provider discovery](./developers/provider-discovery.md) and [EVM API overview](./evm-api/overview.md).
- **UTXO and Syscoin developers** should start with [UTXO and Syscoin API overview](./utxo-syscoin-api/overview.md).
- **Institutions and smart-account dapps** should start with [Pali smart accounts](./passkeys-institutions/overview.md).

## Provider surfaces

| Provider | Chain family | Primary use |
| --- | --- | --- |
| `window.ethereum` | EVM | MetaMask-compatible dapp integrations, signing, transactions, permissions, and EIP-5792 batches. |
| `window.pali` | UTXO / Syscoin | Syscoin UTXO accounts, PSBT signing, xpub/change address workflows, and asset helpers. |

## Important safety model

Pali is intentionally conservative. Dapps connect per host, blocking approvals are serialized, network-type mismatches are handled explicitly, and users approve sensitive actions in the extension UI. Many sites can be connected, but each site has one active connected account at a time.
