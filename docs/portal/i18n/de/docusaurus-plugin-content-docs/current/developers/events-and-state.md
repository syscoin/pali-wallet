---
title: Events und Provider-Zustand
---

Hören Sie auf Provider-Events, damit Ihre App synchron bleibt, wenn der Benutzer Account, Netzwerk, Sperrzustand oder UTXO-Zustand ändert.

## EVM-Events

```js
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('EVM accounts', accounts);
});

window.ethereum.on('chainChanged', (chainId) => {
  console.log('EVM chain', chainId);
});

window.ethereum.on('disconnect', (error) => {
  console.warn('Provider disconnected', error);
});
```

## Benutzerdefinierte Pali-Events

Pali emittiert außerdem benutzerdefinierte Wallet-Benachrichtigungen, die vom Erweiterungs-Provider verwendet werden.

| Event | Bedeutung |
| --- | --- |
| `pali_accountsChanged` | Der verbundene Account hat sich geändert. |
| `pali_chainChanged` | Die aktive Chain hat sich geändert. |
| `pali_unlockStateChanged` | Der Wallet-Sperrzustand hat sich geändert. |
| `pali_isBitcoinBased` | Die aktive UTXO-Familie hat sich geändert. |
| `pali_xpubChanged` | Das verbundene UTXO-xpub hat sich geändert. |
| `pali_blockExplorerChanged` | Der aktive UTXO-Explorer hat sich geändert. |

## Provider-Zustandsmethoden

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

Provider-Zustand ist für die Initialisierung nützlich, sollte aber nicht als Ersatz für explizite Account-Berechtigungsprüfungen behandelt werden.
