---
title: What is Pali?
---

Pali Wallet is the official Syscoin wallet extension and a general-purpose web3 wallet for EVM-compatible chains. It is designed for three overlapping audiences:

- **Regular users** who want a secure browser wallet for EVM, Syscoin, Rollux, and UTXO assets.
- **Dapp developers** who want MetaMask-compatible EVM access and UTXO access from the same extension.
- **Institutions** that want modular smart accounts, configurable validators, account recovery, and dapp-driven onboarding.

## What makes Pali different

Most browser wallets expose only an EVM provider. Pali exposes two complementary surfaces:

- `window.ethereum` for EVM dapps, intentionally compatible with common MetaMask flows.
- `window.pali` for Syscoin UTXO and Bitcoin-style flows.

This lets a dapp build experiences that cross account-based and UTXO-based chains without asking users to install different wallets.

## What is different about Pali?

Pali is built around one idea: the wallet should be the user's security boundary, not a server. Pali can read from RPC nodes, explorers, and indexers like any browser wallet, but custody, approvals, recovery, and account policy stay with the user's keys and on-chain modules.

- **No custody or recovery server.** Pali does not keep a server-side key, cloud-stored encrypted data, policy engine, or recovery backdoor. Sensitive actions are approved in the extension, signed by the user's wallet, passkey, hardware device, or smart-account validator, and enforced by the chain.
- **Fast reads with graceful fallbacks.** When Pali needs many EVM contract reads, it first tries Multicall3 `aggregate3`: one on-chain `eth_call`, one same-block view, and per-call failure isolation. If Multicall3 is not deployed or the RPC rejects it, Pali falls back to JSON-RPC batching; if batching is not available, it falls back again to individual calls. That keeps the UI fast on modern chains without breaking on basic RPC providers.
- **Two chain families in one wallet.** Pali exposes MetaMask-compatible `window.ethereum` for EVM dapps and `window.pali` for Syscoin UTXO / Bitcoin-style flows. A dapp can work with account-based assets, UTXOs, PSBTs, and xpubs from one extension instead of sending users to separate wallets.
- **Regular accounts and smart accounts.** Users can keep normal EOA-style accounts, hardware wallet accounts, and Pali smart accounts side by side. Regular accounts are simple and portable. Smart accounts add programmable policy: passkeys, wallet-owned ECDSA validators, composite threshold policies, guardian recovery, and custom modules.
- **Standards-first dapp integration.** Pali follows the wallet APIs dapps already use: EIP-1193, EIP-6963, EIP-2255 permissions, EIP-5792 `wallet_sendCalls`, EIP-712 typed data, and MetaMask-compatible request behavior. Pali smart accounts use ERC-7579-style validator/executor modules and ERC-4337-style execution data, so account behavior is based on public standards rather than a Pali-only API.
- **Programmable authorization.** In a Pali smart account, the address is stable but the signer policy can evolve. A validator decides who may approve actions; an executor adds features such as guardian recovery. That means a team can move from one validator to a threshold policy, add recovery, or later adopt new validator types without moving funds to a new address.
- **Designed for stronger future signatures.** Because authorization is modular, future validators can support schemes beyond today's ECDSA and P-256 passkeys, including post-quantum signature designs when they are practical for the target chain. Pali's model is meant to let stronger signature modules plug into the same account rather than forcing users to migrate.
- **Safety before convenience.** Pali serializes blocking approvals, checks connected sites and network context, blocks high-risk blacklist hits for sends and approvals, and keeps guardian recovery separate from transaction signing. Guardians can help recover access after a delay; they cannot silently spend funds.

Pali's direction is **self-custodial programmable accounts for real users and real dapps**: fast enough for everyday wallet use, standard enough for developers, flexible enough for institutions, and conservative enough that security-critical control remains with the user and the chain.

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
