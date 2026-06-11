---
title: Glossary
---

## Account family

The wallet account model used by a network. EVM accounts are account-based. Syscoin UTXO and Bitcoin-style accounts are UTXO-based.

## EIP-1193

The standard JavaScript provider interface used by Ethereum wallets through `provider.request()`.

## EIP-6963

A multi-wallet discovery standard that lets dapps discover providers without relying only on `window.ethereum`.

## Guardian recovery

A delayed smart-account recovery module. Guardians sign a recovery intent, the module schedules it with a timelock, and finalization replaces the account's validator after the delay. Guardian approvals are verified with ECDSA or ERC-1271, so a guardian can be a normal address or a deployed contract account (including another smart account with a composite, custom, or post-quantum validator).

## Pali smart account

An EVM contract account created by Pali. It uses modules to decide who can authorize actions and which recovery features are available.

## Passkey validator

A smart-account validator module that verifies WebAuthn/P-256 proofs so a passkey approval can authorize account actions.

## PSBT

Partially Signed Bitcoin Transaction. A common format for coordinating UTXO transaction signing.

## Smart-account validator

A module that decides whether a smart-account action is authorized. Pali supports ECDSA, P-256 WebAuthn, and composite validators.

## SPT

Syscoin Platform Token, an asset on the Syscoin UTXO side.

## UTXO

Unspent Transaction Output. The account model used by Bitcoin-like chains and Syscoin UTXO.

## WebAuthn

The browser standard behind passkeys. It lets users approve cryptographic actions through platform authenticators, hardware keys, or synced passkey providers.
