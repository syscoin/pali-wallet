---
title: What is Pali?
---

Pali Wallet is the official Syscoin wallet extension and a general-purpose web3 wallet for EVM-compatible chains. It is designed for three overlapping audiences:

- **Regular users** who want a secure browser wallet for EVM, Syscoin, Rollux, and UTXO assets.
- **Dapp developers** who want MetaMask-compatible EVM access and UTXO access from the same extension.
- **Institutions** that want modular smart accounts, passkey approvals, account recovery, and dapp-driven onboarding.

## What makes Pali different

Most browser wallets expose only an EVM provider. Pali exposes two complementary surfaces:

- `window.ethereum` for EVM dapps, intentionally compatible with common MetaMask flows.
- `window.pali` for Syscoin UTXO and Bitcoin-style flows.

This lets a dapp build experiences that cross account-based and UTXO-based chains without asking users to install different wallets.

## Compatibility at a glance

| Capability | Supported surface |
| --- | --- |
| EIP-1193 provider requests | `window.ethereum` |
| EIP-6963 wallet discovery | `window.ethereum` provider announcement |
| Account permissions | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| EVM transactions and signatures | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, related signing methods |
| EIP-5792 batch requests | `wallet_sendCalls`, `wallet_getCapabilities` |
| UTXO account and xpub state | `window.pali` and `sys_*` methods |
| PSBT signing and broadcast | `sys_sign`, `sys_signAndSend` |
| Smart account creation | `wallet_prepareSmartAccount` |

## Current smart-account scope

Pali smart accounts are available on EVM networks where the Pali factory and module contracts exist at the addresses Pali uses. This Pali build configures `zkTanenbaum` testnet (`57057`), and zkSYS production support uses the same architecture once the production factory and module addresses are configured.

The infrastructure is not permissioned to Pali-operated chains. On compatible EVM networks with canonical CREATE2 support, Pali can deploy the required smart-account setup from inside the wallet: open Settings, go to Advanced, and use the **Smart account setup** Deploy button. Passkey validators additionally require P-256 WebAuthn proof verification, commonly provided by a P-256/passkey precompile on modern EVM environments. Dapps should still check capabilities and handle chains that are not ready yet.
