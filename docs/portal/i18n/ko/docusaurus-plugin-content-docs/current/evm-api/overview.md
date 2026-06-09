---
title: EVM API 개요
---

Pali의 EVM provider는 `window.ethereum`을 통해 노출되며 표준 MetaMask-style dapp integration과 호환됩니다.

## 일반 method

| 영역 | Method |
| --- | --- |
| Connect | `eth_requestAccounts`, `eth_accounts` |
| Network | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| Transactions | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| Signing | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Permissions | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Assets | `wallet_watchAsset` |
| Batches | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkeys | `wallet_prepareSmartAccount` |

## Provider request 형태

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## Read-only RPC proxying

Pali는 block, transaction, receipt, log, fee, balance, code, storage, proof query를 포함한 많은 read-only Ethereum JSON-RPC method를 active RPC provider로 forward합니다.

## 지원되지 않는 subscription

`eth_subscribe`와 `eth_unsubscribe`는 in-wallet provider에서 지원되지 않습니다. subscription이 많은 application state에는 자체 WebSocket RPC provider를 사용하세요.
