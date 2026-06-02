---
title: Events
---

Subscribe to events after selecting the provider.

## EIP-1193 events

| Event | Provider | Meaning |
| --- | --- | --- |
| `connect` | `window.ethereum` | Provider connected. |
| `disconnect` | `window.ethereum` | Provider disconnected. |
| `accountsChanged` | `window.ethereum` | EVM account list changed. |
| `chainChanged` | `window.ethereum` | EVM chain changed. |
| `message` | `window.ethereum` | Provider message. |

## Pali wallet notifications

| Event | Meaning |
| --- | --- |
| `pali_accountsChanged` | Connected account changed. |
| `pali_chainChanged` | Active chain changed. |
| `pali_unlockStateChanged` | Wallet lock state changed. |
| `pali_isBitcoinBased` | Active UTXO family state changed. |
| `pali_xpubChanged` | Connected UTXO xpub changed. |
| `pali_blockExplorerChanged` | Active block explorer changed. |
| `walletUpdate` | Wallet state update notification. |

## Example

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

Remove listeners when your component unmounts to avoid duplicated state updates.
