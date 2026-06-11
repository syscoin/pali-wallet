---
title: Eigenheiten und Einschränkungen
---

Diese Seite dokumentiert Verhalten, das dapps berücksichtigen sollten.

## Verbindungen und Popups

- Viele dapp-Hosts können verbunden sein.
- Jeder Host hat jeweils einen aktiven verbundenen Account.
- Blockierende Freigabe-Popups werden serialisiert und in eine Warteschlange gestellt.
- Doppelte aktive Popup-Routen können abgelehnt werden.
- Popup-Spam kann vorübergehend blockiert werden.

## UTXO- und EVM-Trennung

- `window.ethereum` ist für EVM.
- `window.pali` ist für UTXO/Syscoin.
- Der Aufruf einer Methode aus der falschen Chain-Familie kann fehlschlagen oder einen Netzwerkwechsel erfordern.
- UTXO/EVM-Wechsel können trennen und erneutes Verbinden erfordern.

## EIP-5792-Status

- `wallet_sendCalls` ist implementiert.
- `wallet_getCapabilities` ist implementiert.
- `wallet_getCallsStatus` ist implementiert; unbekannte Bundle-IDs schlagen mit Fehler `5730` fehl.
- `wallet_showCallsStatus` ist implementiert und zeigt den Batch-Status in einem Wallet-Popup an.

## Atomicity

- Passkey Smart Accounts können ausgewählte Batch-Calls durch eine Smart-Account-Ausführung ausführen.
- Normale EOA-Batch-Calls sind sequenzielle Wallet-Sends und sollten nicht als echte atomare Ausführung behandelt werden.

## Subscriptions

`eth_subscribe` und `eth_unsubscribe` werden nicht unterstützt. Verwenden Sie einen dedizierten WebSocket-RPC-Provider für Echtzeit-Chain-Subscriptions.

## Passkeys

- Passkey-Smart-Account-Unterstützung hängt davon ab, dass die Pali Factory und Module auf der aktiven Chain vorhanden sind. Auf kompatiblen EVM-Chains mit kanonischem CREATE2-Support kann Pali diese Einrichtung über Settings > Advanced > **Smart account setup** deployen.
- Contract-Deployment-Calls werden über Passkey-`wallet_sendCalls` nicht unterstützt.
- `policyText` ist Wallet-Metadatum und Anzeigetext, kein on-chain Enforcement.
- Der erforderliche Sponsor-Modus hängt von Sponsor-Service-Verfügbarkeit und Proof-Validierung ab.

## Iframes

Pali injiziert Provider in Top-Level-Seiten, nicht in iframes.
