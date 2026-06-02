---
title: EIP 및 호환성
---

Pali는 실제 dapp이 사용하는 wallet standard를 지원하면서 UTXO 및 passkey capability를 추가하는 것을 목표로 합니다.

## EVM wallet standard

| Standard | Pali support |
| --- | --- |
| EIP-1193 | `window.ethereum`을 통한 provider request/event/error. |
| EIP-6963 | Multi-wallet discovery 및 provider announcement. |
| EIP-1102 | `enable()`은 account request method를 위해 deprecated되었습니다. |
| EIP-1474 | Ethereum RPC용 JSON-RPC style error code. |
| EIP-2255 | Wallet permission method. |
| EIP-3085 | `wallet_addEthereumChain`. |
| EIP-3326 | `wallet_switchEthereumChain`. |
| EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities`, status compatibility method. |
| EIP-712 | `eth_signTypedData_v4` 및 관련 method를 통한 typed data signing. |
| EIP-747 | `wallet_watchAsset`. |

## MetaMask compatibility

Pali는 MetaMask-style behavior를 기대하는 dapp을 위해 `window.ethereum`을 노출합니다. 또한 legacy integration을 위해 provider를 MetaMask-compatible로 표시하고 modern wallet selection을 위해 EIP-6963을 통해 announce합니다.

## EVM을 넘어서는 Pali extension

Pali는 UTXO/Syscoin flow용 `window.pali`를 추가합니다. 이러한 method는 Ethereum EIP가 아니며, UTXO account state, PSBT signing, Syscoin asset, Bitcoin-style dapp flow를 위한 Pali의 browser wallet API입니다.

## Compatibility caveat

- EVM subscription은 extension provider에서 지원되지 않습니다.
- `wallet_getCallsStatus`와 `wallet_showCallsStatus`는 compatibility stub입니다.
- EOA `wallet_sendCalls` execution은 순차적이며, 진정한 on-chain atomicity가 아닙니다.
- UTXO 및 EVM network family는 provider surface와 wallet state로 분리됩니다.
