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

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Best Practices

- Erstellen Sie PSBTs deterministisch und zeigen Sie Benutzern eine Transaktionszusammenfassung in Ihrer App.
- Verwenden Sie Palis Wechselgeldadresse, statt Empfangsadressen wiederzuverwenden.
- Behandeln Sie Testnet/Mainnet-Unterschiede.
- Behandeln Sie Wallet-Sperre, Ablehnung und Netzwerkabweichungsfehler.
- Vermeiden Sie xpub- oder Signatur-Requests, bis der Benutzer eine sinnvolle Aktion initiiert.
