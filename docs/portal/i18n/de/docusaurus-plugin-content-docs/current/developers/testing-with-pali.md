---
title: Testen mit Pali
---

Verwenden Sie die Syscoin-Test-dapp für manuelle Integrationstests und Ihre eigenen automatisierten Tests für Anwendungslogik.

## Gehostete Test-dapp

Die Syscoin-Test-dapp wird hier gehostet:

```text
https://syscoin-test-dapp.vercel.app/
```

Sie umfasst Pali-Passkey-Flows, `wallet_createPasskeyAccount`, `wallet_sendCalls`, ERC-20-Allowance-Batch-Erzeugung und gängige Wallet-Requests.

## Lokale Test-dapp

Wenn Sie unveröffentlichte Änderungen testen müssen:

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## Lokale Pali-Erweiterung

```bash
git clone https://github.com/syscoin/pali_wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

Laden Sie anschließend `build/chrome` über die Entwicklerseite für Browser-Erweiterungen.

## Passkey-Test-Checkliste

1. Verbinden Sie Pali über die Standard-Provider-Auswahl.
2. Erstellen oder stellen Sie einen Passkey-Account mit deaktiviertem Sponsoring wieder her.
3. Fundieren oder deployen Sie den Passkey-Account, falls Ihr Test dies erfordert.
4. Erstellen Sie einen ERC-20-Approve-plus-`transferFrom`-Batch.
5. Senden Sie den Batch mit `wallet_sendCalls`.
6. Bestätigen Sie, dass die Wallet decodierte calldata und eine einzelne WebAuthn-Freigabe für den Passkey-Batch zeigt.
