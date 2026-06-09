---
title: Privacy and safety
---

Pali is designed to minimize what dapps can learn without explicit user action.

## What Pali does not expose

Pali does not expose seed phrases, private keys, passkey private material, wallet passwords, or unrestricted account lists to web pages.

## What dapps can request

Dapps can request public account addresses, provider state, network state, signatures, transaction approvals, PSBT signing, asset watch approvals, chain switching, smart-account creation, and batch execution.

## Connection safety

Only connect to dapps you trust. A connected dapp can see the account you approved for that origin and can request future actions. You can revoke site access from the wallet.

## Public blockchain data

Blockchain activity is public. Your address, transaction history, token approvals, UTXO activity, smart-account deployment, and smart-account activity may be visible on explorers and indexers.

## Smart-account privacy

Smart-account modules and executions are public on-chain. If a dapp asks to install an ECDSA owner or recovery module, review the owner addresses and recovery settings before approving.
