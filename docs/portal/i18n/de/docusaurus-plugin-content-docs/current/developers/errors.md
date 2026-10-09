---
title: Fehler
---

Umschließen Sie Provider-Anfragen immer mit `try` / `catch`. Pali verwendet nach Möglichkeit standardmäßige Fehler im JSON-RPC- und EIP-1193-Stil sowie Wallet-spezifische Fehler für nicht unterstützte Netzwerke, Hardware-Wallet-Einschränkungen und Passkey-Zustände.

```js
try {
  await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx],
  });
} catch (error) {
  switch (error.code) {
    case 4001:
      console.log('User rejected the request.');
      break;
    case 4100:
      console.log('The dapp is not authorized.');
      break;
    case 4200:
      console.log('The method is unsupported.');
      break;
    default:
      console.error(error);
  }
}
```

## Häufige Kategorien

| Code | Bedeutung |
| --- | --- |
| `4001` | Der Nutzer hat die Anfrage abgelehnt. |
| `4100` | Nicht autorisiertes Konto oder nicht autorisierte Methode. |
| `4101` | Die Methode ist nur für eine andere Chain-Familie verfügbar. |
| `4200` | Nicht unterstützte Methode. |
| `4900` | Provider nicht verbunden. |
| `4901` | Provider nicht mit der angeforderten Chain verbunden. |
| `5710` | Für die Chain des EIP-5792-Bundles ist in der Wallet kein RPC konfiguriert (`wallet_getCallsStatus` / `wallet_showCallsStatus`). |
| `5720` | Doppelte, von der Dapp bereitgestellte EIP-5792-Bundle-ID in `wallet_sendCalls`. |
| `5730` | Unbekannte EIP-5792-Bundle-ID in `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

Siehe [Fehlercodes](../reference/error-codes.md) für die ausführlichere Referenz.

## Unterbrochene Anfragen erneut versuchen

Eine Zeitüberschreitung, ein geschlossenes Freigabefenster oder eine unterbrochene Verbindung beweist nicht immer, dass eine Transaktion nie gesendet wurde. Prüfen Sie bekannte Transaktions-Hashes, den Transaktionsverlauf oder den Bundle-Status, bevor Sie eine weitere Signatur oder Übermittlung anfordern. Eine bestätigte Übermittlung bleibt erfolgreich, auch wenn die spätere Aktualisierung des lokalen Transaktionsverlaufs fehlschlägt.

Wiederholen Sie gewöhnliche Lesezugriffe, wenn dies angemessen ist. Führen Sie Anfragen zum Signieren, Erstellen einer Wallet oder Senden einer Transaktion nach einem unklaren Ergebnis jedoch nicht automatisch erneut aus. Wenn sich Konto oder Netzwerk geändert haben, holen Sie eine neue Freigabe für den aktuellen Kontext ein. Prüfen Sie bei einer ausstehenden Smart-Account-Einrichtung den Status im ursprünglichen Netzwerk, bevor Sie ein weiteres Deployment versuchen.
