---
title: Fehler
---

Umschließen Sie Provider-Requests immer mit `try` / `catch`. Pali verwendet, wo möglich, standardmäßige Fehler im JSON-RPC- und EIP-1193-Stil sowie wallet-spezifische Fehler für nicht unterstützte Netzwerke, Hardware-Wallet-Einschränkungen und Passkey-Zustände.

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
| `4001` | Benutzer hat den Request abgelehnt. |
| `4100` | Nicht autorisierter Account oder nicht autorisierte Methode. |
| `4101` | Methode ist nur für eine andere Chain-Familie verfügbar. |
| `4200` | Nicht unterstützte Methode. |
| `4900` | Provider getrennt. |
| `4901` | Provider von der angeforderten Chain getrennt. |
| `5730` | Unbekannte EIP-5792-Bundle-ID in `wallet_getCallsStatus`. |

Siehe [Fehlercodes](../reference/error-codes.md) für die längere Referenz.
