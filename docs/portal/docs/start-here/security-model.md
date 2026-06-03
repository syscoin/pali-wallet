---
title: Security model
---

Pali is a non-custodial wallet. It does not expose private keys to dapps. Dapps send requests to the injected provider, Pali validates and routes those requests, and users approve sensitive actions in the extension UI.

## Core principles

- **Origin-scoped connections:** connections are stored per dapp host.
- **One active account per dapp:** a connected site has one active account at a time, even though many sites may be connected.
- **Serialized approvals:** blocking requests that open popups are coordinated so users are not buried under competing approvals.
- **Network-family checks:** EVM methods and UTXO methods are separated. Wrong-family calls should be handled as recoverable dapp errors.
- **Explicit signing:** transactions, PSBTs, typed data, message signing, passkey creation, passkey executions, asset watch requests, and chain changes require the right wallet state and user approval.
- **Provider isolation:** Pali injects providers into the top-level page. It does not inject into iframes.

## What dapps receive

Dapps receive public account identifiers, provider state, signatures, transaction hashes, and explicit RPC results. They never receive seed phrases, private keys, passkey private material, or authenticator secrets.

## Passkey safety

Passkey smart accounts use WebAuthn credentials. Pali stores public metadata and credential identifiers; private key material remains inside the authenticator. Pali rejects cross-origin WebAuthn assertions and verifies that passkey action hashes match the prepared transaction set.

## Sponsor policy safety

Institutional sponsor policy is split into:

- **On-chain policy:** mode, sponsor signer, and sponsor URL.
- **Wallet metadata:** display policy text and other wallet-local context.

The `policyText` field is shown to users as context. It is not an on-chain enforcement primitive.
