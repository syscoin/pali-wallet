---
title: User getting started
---

Pali lets you manage EVM accounts, Syscoin UTXO accounts, and modular smart accounts from one extension.

## Basic setup

1. Install the Pali extension.
2. Create a new wallet or import an existing seed phrase.
3. Set a strong password.
4. Back up your seed phrase offline.
5. Choose the network you want to use.
6. Connect only to dapps you trust.

## Setup and loading

Keep unfinished setup open and visible. Leaving, hiding, or reloading it clears sensitive setup inputs and may require you to start again. Keep the recovery phrase you backed up.

If Pali cannot confirm that wallet creation finished, let it reload and check the wallet. If an unlock screen appears, use the password you just set. Do not assume an interrupted response means no wallet was created or immediately repeat creation.

During a slow operation, Pali can show recovery options while keeping navigation available. Sensitive actions still wait for the account and network to settle. Receive temporarily hides its address, QR code, and copy control; faucet claims also wait. Check the account and network again before continuing.

## Connecting to a dapp

When a site requests access, Pali opens a connection popup that shows the site and lets you choose the account. A dapp receives only the connected account address and approved provider state.

Pali stores connections by site. You can connect different sites to different accounts, but each site has one active account at a time.

## EVM accounts

Use EVM accounts for Ethereum-compatible chains, Rollux, Syscoin NEVM, and dapps that expect MetaMask-style wallet behavior.

EVM dapps can request:

- account access
- transactions
- personal signatures
- typed data signatures
- token watch requests
- chain add/switch requests
- batch call requests

## UTXO accounts

Use UTXO accounts for Syscoin UTXO and Bitcoin-style transaction flows. UTXO dapps may request xpub-aware state, change addresses, PSBT signing, and transaction broadcast.

## Smart accounts

Smart accounts are contract accounts controlled by modules. Pali can create accounts controlled by a passkey validator, a wallet-owned ECDSA validator, or a co-managed policy. They are useful for dapp onboarding, batched actions, and guardian recovery. Some smart accounts are counterfactual until their first deployment transaction.
