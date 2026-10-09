---
title: Errors
---

Always wrap provider requests in `try` / `catch`. Pali uses standard JSON-RPC and EIP-1193 style errors where possible, plus wallet-specific errors for unsupported networks, hardware wallet restrictions, and passkey states.

```js
try {
  await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx],
  });
} catch (error) {
  switch (error.code) {
    case 4001:
      console.log('User rejected the request.');
      break;
    case 4100:
      console.log('The dapp is not authorized.');
      break;
    case 4200:
      console.log('The method is unsupported.');
      break;
    default:
      console.error(error);
  }
}
```

## Common categories

| Code | Meaning |
| --- | --- |
| `4001` | User rejected the request. |
| `4100` | Unauthorized account or method. |
| `4101` | Method is only available for a different chain family. |
| `4200` | Unsupported method. |
| `4900` | Provider disconnected. |
| `4901` | Provider disconnected from the requested chain. |
| `5710` | The EIP-5792 bundle's chain has no RPC configured in the wallet (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | Duplicate dapp-provided EIP-5792 bundle id in `wallet_sendCalls`. |
| `5730` | Unknown EIP-5792 bundle id in `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

See [Error codes](../reference/error-codes.md) for the longer reference.

## Retrying interrupted requests

A timeout, closed approval window, or lost connection does not always prove that a transaction was never submitted. Before requesting another signature or submission, check any known transaction hash, transaction history, or bundle status. An acknowledged broadcast remains successful even if a later local history update fails.

Retry ordinary reads when appropriate, but do not automatically replay signing, wallet creation, or broadcast requests after an uncertain outcome. If the account or network changed, obtain a fresh approval for the current context. For pending smart-account setup, check its status on the original network before attempting another deployment.
