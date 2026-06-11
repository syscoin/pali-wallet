---
title: Fehlercodes
---

Pali verwendet JSON-RPC, EIP-1193, EIP-1474 und wallet-spezifische Fehler. dapps sollten immer sowohl `error.code` als auch `error.message` prüfen.

## Standard-JSON-RPC

| Code | Bedeutung |
| --- | --- |
| `-32700` | Parse-Fehler. |
| `-32600` | Ungültiger Request. |
| `-32601` | Methode nicht gefunden oder nicht verfügbar. |
| `-32602` | Ungültige Params. |
| `-32603` | Interner Fehler. |

## Ethereum-Provider-Fehler

| Code | Bedeutung |
| --- | --- |
| `4001` | Benutzer hat den Request abgelehnt. |
| `4100` | Nicht autorisierter Account oder nicht autorisierte Methode. |
| `4200` | Nicht unterstützte Methode. |
| `4900` | Provider getrennt. |
| `4901` | Provider von der angegebenen Chain getrennt. |

## Fehler im EIP-1474-Stil

| Code | Bedeutung |
| --- | --- |
| `-32000` | Ungültige Eingabe. |
| `-32001` | Ressource nicht gefunden. |
| `-32002` | Ressource nicht verfügbar. |
| `-32003` | Transaktion abgelehnt. |
| `-32004` | Methode nicht unterstützt. |
| `-32005` | Request-Limit überschritten. |

## Häufige Pali-spezifische Fehler

| Code | Bedeutung |
| --- | --- |
| `4101` | Methode ist nur für eine andere Chain-Familie verfügbar, etwa nur EVM oder nur UTXO. |
| `4874` | Methode unterstützt keine Hardware-Wallets. |
| `5720` | Doppelte von der Dapp gelieferte Bundle-ID in `wallet_sendCalls`. |
| `5730` | Unbekannte Bundle-ID für `wallet_getCallsStatus` / `wallet_showCallsStatus`. |

## Best Practices

- Behandeln Sie `4001` als normale Benutzerstornierung.
- Behandeln Sie `4101` als Hinweis, den Benutzer zur richtigen Netzwerkfamilie zu führen.
- Wiederholen Sie blockierende Requests nicht in einer engen Schleife. Pali schützt Benutzer vor Popup-Spam.
- Zeigen Sie handlungsorientierten Text für Passkey-Sponsor-Fehler, insbesondere im erforderlichen Sponsor-Modus.
