---
title: Quirks and limitations
---

This page documents behavior dapps should account for.

## Connections and popups

- Many dapp hosts can be connected.
- Each host has one active connected account at a time.
- Blocking approval popups are serialized and queued.
- Duplicate active popup routes may be rejected.
- Popup spam can be temporarily blocked.

## UTXO and EVM separation

- `window.ethereum` is for EVM.
- `window.pali` is for UTXO/Syscoin.
- Calling a method from the wrong chain family can fail or require a network switch.
- UTXO/EVM switching can disconnect and require reconnecting.

## EIP-5792 status

- `wallet_sendCalls` is implemented.
- `wallet_getCapabilities` is implemented.
- `wallet_getCallsStatus` returns unknown bundle id for unsupported status lookups.
- `wallet_showCallsStatus` is a no-op compatibility method.

## Atomicity

- Passkey smart accounts can execute selected batch calls through one smart account execution.
- Regular EOA batch calls are sequential wallet sends and should not be treated as true atomic execution.

## Subscriptions

`eth_subscribe` and `eth_unsubscribe` are unsupported. Use a dedicated WebSocket RPC provider for realtime chain subscriptions.

## Passkeys

- Passkey smart account support depends on factory configuration for the active chain.
- Contract deployment calls are not supported through passkey `wallet_sendCalls`.
- `policyText` is wallet metadata and display text, not on-chain enforcement.
- Required sponsor mode depends on sponsor service availability and proof validation.

## Iframes

Pali injects providers into top-level pages, not iframes.
