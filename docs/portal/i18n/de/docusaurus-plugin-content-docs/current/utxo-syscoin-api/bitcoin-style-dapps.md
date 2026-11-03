---
title: Bitcoin-artige dapps
---

Palis UTXO-Provider ermöglicht Browser-dapps für Bitcoin-artige Account-Flows, einschließlich Syscoin UTXO und kompatibler Transaktionsmodelle.

## Was sich gegenüber EVM ändert

EVM-dapps bitten normalerweise einen Account, ein Transaktionsobjekt zu signieren. UTXO-dapps üblicherweise:

1. Lesen Account- und UTXO-Zustand.
2. Erstellen eine PSBT.
3. Fügen eine Wechselgeldadresse hinzu.
4. Bitten die Wallet um Signatur.
5. Finalisieren und broadcasten.

## Minimale Integrationsform

Übergeben Sie ein strukturiertes Pali-PSBT-Objekt, keinen reinen Base64-String. `syscoinjs-lib` exportiert `{ psbt: <base64>, assets: <JSON-String> }`; geben Sie gegebenenfalls die Asset-Map an. `sys_sign` liefert ein signiertes Objekt im gleichen Format, das teilweise signiert bleiben kann. Das zurückgegebene Feld `assets` ist leer; bewahren Sie benötigte Asset-Metadaten separat auf.

```js
import { utils as sys } from 'syscoinjs-lib';

const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

// Supply your constructed syscoinjs PSBT and optional asset map.
const paliPsbt = sys.exportPsbtToJson(psbt, assetsMap);
const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [paliPsbt],
});
```

## Best Practices

- Erstellen Sie PSBTs deterministisch und zeigen Sie Benutzern eine Transaktionszusammenfassung in Ihrer App.
- Verwenden Sie Palis Wechselgeldadresse, statt Empfangsadressen wiederzuverwenden.
- Behandeln Sie Testnet/Mainnet-Unterschiede.
- Behandeln Sie Wallet-Sperre, Ablehnung und Netzwerkabweichungsfehler.
- Vermeiden Sie xpub- oder Signatur-Requests, bis der Benutzer eine sinnvolle Aktion initiiert.
