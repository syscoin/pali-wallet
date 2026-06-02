---
title: Events
---

Abonnieren Sie Events, nachdem Sie den Provider ausgewählt haben.

## EIP-1193-Events

| Event | Provider | Bedeutung |
| --- | --- | --- |
| `connect` | `window.ethereum` | Provider verbunden. |
| `disconnect` | `window.ethereum` | Provider getrennt. |
| `accountsChanged` | `window.ethereum` | EVM-Account-Liste hat sich geändert. |
| `chainChanged` | `window.ethereum` | EVM-Chain hat sich geändert. |
| `message` | `window.ethereum` | Provider-Nachricht. |

## Pali-Wallet-Benachrichtigungen

| Event | Bedeutung |
| --- | --- |
| `pali_accountsChanged` | Verbundener Account hat sich geändert. |
| `pali_chainChanged` | Aktive Chain hat sich geändert. |
| `pali_unlockStateChanged` | Wallet-Sperrzustand hat sich geändert. |
| `pali_isBitcoinBased` | Aktiver UTXO-Familienzustand hat sich geändert. |
| `pali_xpubChanged` | Verbundenes UTXO-xpub hat sich geändert. |
| `pali_blockExplorerChanged` | Aktiver Block-Explorer hat sich geändert. |
| `walletUpdate` | Wallet-Zustandsaktualisierungs-Benachrichtigung. |

## Beispiel

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

Entfernen Sie Listener, wenn Ihre Komponente unmounted, um doppelte Zustandsaktualisierungen zu vermeiden.
