---
title: Events and provider state
---

Listen to provider events so your app stays in sync when the user changes account, network, lock state, or UTXO state.

## EVM events

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

## Pali custom events

Pali also emits custom wallet notifications used by the extension provider.

| Event | Meaning |
| --- | --- |
| `pali_accountsChanged` | The connected account changed. |
| `pali_chainChanged` | The active chain changed. |
| `pali_unlockStateChanged` | The wallet lock state changed. |
| `pali_isBitcoinBased` | The active UTXO family changed. |
| `pali_xpubChanged` | The connected UTXO xpub changed. |
| `pali_blockExplorerChanged` | The active UTXO explorer changed. |

## Provider state methods

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

Provider state is useful for initialization, but do not treat it as a substitute for explicit account permission checks.
