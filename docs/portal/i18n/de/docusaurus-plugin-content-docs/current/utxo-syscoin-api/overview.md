---
title: UTXO und Syscoin API Überblick
---

Pali stellt UTXO- und Syscoin-Fähigkeiten über `window.pali` bereit.

Verwenden Sie diesen Provider, wenn Ihre App Folgendes benötigt:

- Syscoin UTXO-Account-Zugriff.
- PSBT-Signatur.
- Transaktions-Broadcast.
- Wechselgeldadressen.
- xpub des verbundenen Accounts.
- UTXO-Transaktionshistorie.
- Syscoin Platform Token-Asset-Metadaten und Bestände.

## Verbinden

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Pali UTXO-Verbindungspopup für eine Syscoin-dapp" />
</a>
  <figcaption>UTXO-dapps verbinden sich über <code>window.pali</code>, nicht über <code>window.ethereum</code>.</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Provider-Hilfsfunktionen

`window.pali` enthält requestbasierte RPC-Methoden und `_sys`-Hilfsmethoden für gängige Syscoin-Asset-Lesevorgänge.

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## Regeln für Chain-Familien

UTXO-Methoden erfordern, dass sich die Wallet in einem kompatiblen UTXO/Syscoin-Netzwerkkontext befindet. Wenn Ihre App auch EVM unterstützt, halten Sie die Provider-Aufrufe getrennt und behandeln Sie Moduswechsel explizit.
