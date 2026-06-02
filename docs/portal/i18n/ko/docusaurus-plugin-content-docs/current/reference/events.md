---
title: Event
---

provider를 선택한 뒤 event를 subscribe하세요.

## EIP-1193 event

| Event | Provider | 의미 |
| --- | --- | --- |
| `connect` | `window.ethereum` | Provider가 connected 상태입니다. |
| `disconnect` | `window.ethereum` | Provider가 disconnected 상태입니다. |
| `accountsChanged` | `window.ethereum` | EVM account list가 변경되었습니다. |
| `chainChanged` | `window.ethereum` | EVM chain이 변경되었습니다. |
| `message` | `window.ethereum` | Provider message입니다. |

## Pali wallet notification

| Event | 의미 |
| --- | --- |
| `pali_accountsChanged` | Connected account가 변경되었습니다. |
| `pali_chainChanged` | Active chain이 변경되었습니다. |
| `pali_unlockStateChanged` | Wallet lock state가 변경되었습니다. |
| `pali_isBitcoinBased` | Active UTXO family state가 변경되었습니다. |
| `pali_xpubChanged` | Connected UTXO xpub이 변경되었습니다. |
| `pali_blockExplorerChanged` | Active block explorer가 변경되었습니다. |
| `walletUpdate` | Wallet state update notification입니다. |

## 예시

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

component가 unmount될 때 listener를 제거하여 중복 state update를 피하세요.
