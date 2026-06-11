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
- `wallet_getCallsStatus` is implemented; unknown bundle ids fail with error `5730`.
- `wallet_showCallsStatus` is implemented and shows the batch status in a wallet popup.

## Atomicity

- Pali smart accounts can execute selected batch calls through one smart-account execution.
- Regular EOA batch calls are sequential wallet sends and should not be treated as true atomic execution.

## Subscriptions

`eth_subscribe` and `eth_unsubscribe` are unsupported. Use a dedicated WebSocket RPC provider for realtime chain subscriptions.

## Smart accounts

- Smart-account support depends on the Pali factory and modules existing at the addresses Pali uses for the active chain. Compatible EVM chains can be enabled from Pali Settings > Advanced with the in-wallet Smart account setup Deploy flow when the network has canonical CREATE2 support.
- Contract deployment calls are not supported through smart-account `wallet_sendCalls`.
- External ECDSA owners can approve future account actions; Pali warns before installing them.
- Current smart-account execution uses wallet-paid gas; dapps should not present the flow as gasless.

## Iframes

Pali injects providers into top-level pages, not iframes.
