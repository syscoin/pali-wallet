---
title: What is Pali?
---

Pali Wallet is the official Syscoin wallet extension and a general-purpose web3 wallet for EVM-compatible chains. It is designed for three overlapping audiences:

- **Regular users** who want a secure browser wallet for EVM, Syscoin, Rollux, and UTXO assets.
- **Dapp developers** who want MetaMask-compatible EVM access and UTXO access from the same extension.
- **Institutions** that want passkey smart accounts, account recovery, sponsor policy, and dapp-driven onboarding.

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
| Passkey smart account creation | `wallet_createPasskeyAccount` |

## Current passkey scope

Passkey smart accounts are available only on zkSYS-family EVM networks where Pali has configured the passkey factory contracts and the chain supports P-256 WebAuthn proof verification. This Pali build configures `zkTanenbaum` testnet (`57057`). zkSYS production support uses the same architecture once the production factory address is configured in Pali. Dapps should check capabilities and handle unsupported chains cleanly.
