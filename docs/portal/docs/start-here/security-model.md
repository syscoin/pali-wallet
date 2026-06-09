---
title: Security model
---

Pali is a non-custodial wallet. It does not expose private keys to dapps. Dapps send requests to the injected provider, Pali validates and routes those requests, and users approve sensitive actions in the extension UI.

## Core principles

- **Origin-scoped connections:** connections are stored per dapp host.
- **One active account per dapp:** a connected site has one active account at a time, even though many sites may be connected.
- **Serialized approvals:** blocking requests that open popups are coordinated so users are not buried under competing approvals.
- **Network-family checks:** EVM methods and UTXO methods are separated. Wrong-family calls should be handled as recoverable dapp errors.
- **Explicit signing:** transactions, PSBTs, typed data, message signing, smart-account creation, smart-account executions, asset watch requests, and chain changes require the right wallet state and user approval.
- **Provider isolation:** Pali injects providers into the top-level page. It does not inject into iframes.

## What dapps receive

Dapps receive public account identifiers, provider state, signatures, transaction hashes, and explicit RPC results. They never receive seed phrases, private keys, passkey private material, or authenticator secrets.

## Smart-account and passkey safety

Pali smart accounts use installed modules as the authorization boundary. Passkey validators use WebAuthn credentials; Pali stores public metadata and credential identifiers, while private key material remains inside the authenticator. ECDSA validators use configured owner addresses. External owner addresses are shown to the user because they can approve future account actions.

## Module safety

Installing or replacing a validator changes who controls the smart account. Guardian recovery is a delayed validator replacement path, not a custodial backdoor. Wallet labels and explanatory text are not enforcement primitives; enforcement is through on-chain modules and signatures.
