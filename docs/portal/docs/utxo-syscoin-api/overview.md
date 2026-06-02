---
title: UTXO and Syscoin API overview
---

Pali exposes UTXO and Syscoin capabilities through `window.pali`.

Use this provider when your app needs:

- Syscoin UTXO account access.
- PSBT signing.
- Transaction broadcast.
- Change addresses.
- Connected account xpub.
- UTXO transaction history.
- Syscoin Platform Token asset metadata and holdings.

## Connect

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Pali UTXO connection popup for a Syscoin dapp" />
</a>
  <figcaption>UTXO dapps connect through <code>window.pali</code>, not <code>window.ethereum</code>.</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Provider utilities

`window.pali` includes request-based RPC methods and `_sys` helper methods for common Syscoin asset reads.

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## Chain-family rules

UTXO methods require the wallet to be in a compatible UTXO/Syscoin network context. If your app also supports EVM, keep the provider calls separated and handle mode switching explicitly.
