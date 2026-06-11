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

## What's new in Pali v4

Pali v4 is a ground-up modernization of the wallet around three ideas: speed, standards, and flexible signing authority.

- **Faster everywhere.** Pali batches RPC traffic on both EVM and UTXO networks, so balances, history, and fee data load in far fewer round trips. The result is a wallet that feels instant instead of busy.
- **Standards-based smart accounts.** Pali smart accounts follow the ERC-7579 module model with ERC-4337-style execution encoding. Nothing about the account is proprietary lock-in: validators, executors, and account behavior follow public specifications.
- **Authorization is separate from the account.** Who can sign is a module decision, not a property burned into the address. Today that means wallet-owned ECDSA keys and P-256 WebAuthn passkeys. Tomorrow it can mean new validator types — including post-quantum signature schemes — installed on the same account at the same address, with no ECDSA involved in per-transaction authorization at all.
- **Composable signing policies.** A composite validator combines child validators under a threshold: 1-of-N for convenience, t-of-N for shared control, N-of-N for maximum assurance. Composites can nest, so policies can be hierarchical.
- **Guardians protect against lost access.** Guardian recovery is a separate executor-role module (per ERC-7579), deliberately distinct from validators. Guardians cannot sign transactions; they can only schedule a timelocked validator replacement. Add or remove guardians at any time while the account is healthy.

## Where Pali is going

Pali's direction is **dynamic and flexible signing authority for crypto frontends**. Any frontend — a dapp, an exchange, an institutional dashboard, an embedded service — should be able to ask the wallet for exactly the signing policy the job requires: a passkey for effortless onboarding, a t-of-N composite for a shared treasury, a hardware-backed guardian for recovery, or a future validator type that does not exist yet. The account address stays stable while the authority behind it evolves.

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
