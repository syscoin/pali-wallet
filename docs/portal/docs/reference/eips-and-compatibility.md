---
title: EIPs and compatibility
---

Pali aims to support the wallet standards that real dapps use, while adding UTXO and passkey capabilities.

## EVM wallet standards

| Standard | Pali support |
| --- | --- |
| EIP-1193 | Provider request/events/errors through `window.ethereum`. |
| EIP-6963 | Multi-wallet discovery and provider announcement. |
| EIP-1102 | `enable()` is deprecated in favor of account request methods. |
| EIP-1474 | JSON-RPC style error codes for Ethereum RPC. |
| EIP-2255 | Wallet permissions methods. |
| EIP-3085 | `wallet_addEthereumChain`. |
| EIP-3326 | `wallet_switchEthereumChain`. |
| EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities`, status compatibility methods. |
| EIP-712 | Typed data signing through `eth_signTypedData_v4` and related methods. |
| EIP-747 | `wallet_watchAsset`. |

## MetaMask compatibility

Pali exposes `window.ethereum` for dapps that expect MetaMask-style behavior. It also marks the provider as MetaMask-compatible for legacy integrations and announces itself through EIP-6963 for modern wallet selection.

## Pali extensions beyond EVM

Pali adds `window.pali` for UTXO/Syscoin flows. These methods are not Ethereum EIPs; they are Pali's browser wallet API for UTXO account state, PSBT signing, Syscoin assets, and Bitcoin-style dapp flows.

## Compatibility caveats

- EVM subscriptions are not supported by the extension provider.
- `wallet_getCallsStatus` and `wallet_showCallsStatus` are compatibility stubs.
- EOA `wallet_sendCalls` execution is sequential, not true on-chain atomicity.
- UTXO and EVM network families are separated by provider surface and wallet state.
