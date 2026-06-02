---
title: EVM- und UTXO-Modi
---

Pali unterstützt accountbasierte EVM-Netzwerke und UTXO-basierte Netzwerke. Die Erweiterung verwendet getrennte Provider-Oberflächen, weil die Account-Modelle grundlegend verschieden sind.

## EVM-Modus

Der EVM-Modus ist für dapps, die `window.ethereum` verwenden. Er unterstützt Account-Requests im MetaMask-Stil, Transaktionen, Signaturen, Berechtigungen, Token-Watch-Requests und Netzwerkverwaltung.

Beispiele:

- Rollux- und Syscoin NEVM-dapps
- ERC-20-, ERC-721- und ERC-1155-Interaktionen
- EIP-712 typed data-Signatur
- Erstellung und Ausführung von Passkey Smart Accounts

## UTXO-Modus

Der UTXO-Modus ist für dapps, die `window.pali` verwenden. Er unterstützt Syscoin UTXO-Account-Zustand, xpub-bewusste Integrationen, PSBT-Signatur, Transaktions-Broadcast und SPT-Asset-Flows.

Beispiele:

- Syscoin UTXO-Asset-Anwendungen
- Bitcoin-ähnliche PSBT-Workflows
- dapps, die eine Wechselgeldadresse benötigen
- dapps, die UTXO-Transaktionshistorie lesen

## Modi wechseln

Wenn eine dapp eine Methode für die falsche Chain-Familie anfordert, kann Pali einen Netzwerkwechsel verlangen. dapps sollten diese Fehler sauber behandeln und Benutzer zum richtigen Netzwerk führen.

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

Der Wechsel zwischen UTXO- und EVM-Kontexten kann ein erneutes Verbinden der dapp erfordern, weil sich die aktive Account-Familie ändert.
