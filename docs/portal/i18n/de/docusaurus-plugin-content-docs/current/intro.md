---
title: Willkommen bei Pali Wallet
slug: /
---

Pali Wallet ist eine Browser-Erweiterungs-Wallet für Menschen und Anwendungen, die sowohl accountbasierten als auch UTXO-basierten Blockchain-Zugriff aus einer gemeinsamen Sicherheitsschicht benötigen.

Für EVM-dapps stellt Pali einen MetaMask-kompatiblen `window.ethereum`-Provider mit EIP-1193-Requests, EIP-6963-Discovery, Account-Berechtigungen, Chain-Wechsel, Signaturen, Transaktionen und Batch-Aufrufen bereit. Für Syscoin UTXO und Bitcoin-artige Anwendungen stellt Pali `window.pali` mit Account-, xpub-, Wechselgeldadress-, PSBT-Signatur-, Transaktions- und Asset-Methoden bereit.

Pali unterstützt außerdem Passkey Smart Accounts für Institutionen und fortgeschrittene dapps. Eine dapp kann Pali auffordern, einen durch WebAuthn gestützten Smart Account zu erstellen oder wiederherzustellen, eine Sponsor-Policy anzuhängen und später atomare Batches über `wallet_sendCalls` auszuführen.

## Wählen Sie Ihren Weg

- **Benutzer** sollten mit [Erste Schritte](./users/getting-started.md) beginnen.
- **EVM-Entwickler** sollten mit [Provider-Discovery](./developers/provider-discovery.md) und [EVM API Überblick](./evm-api/overview.md) beginnen.
- **UTXO- und Syscoin-Entwickler** sollten mit [UTXO und Syscoin API Überblick](./utxo-syscoin-api/overview.md) beginnen.
- **Institutionen, die Passkeys verwenden** sollten mit [Passkeys und Institutionen](./passkeys-institutions/overview.md) beginnen.

## Provider-Oberflächen

| Provider | Chain-Familie | Primäre Verwendung |
| --- | --- | --- |
| `window.ethereum` | EVM | MetaMask-kompatible dapp-Integrationen, Signaturen, Transaktionen, Berechtigungen und EIP-5792-Batches. |
| `window.pali` | UTXO / Syscoin | Syscoin UTXO-Accounts, PSBT-Signatur, xpub/Wechselgeldadress-Workflows und Asset-Helfer. |

## Wichtiges Sicherheitsmodell

Pali ist bewusst konservativ. dapps verbinden sich pro Host, blockierende Freigaben werden serialisiert, Netzwerktyp-Abweichungen werden explizit behandelt, und Benutzer bestätigen sensible Aktionen in der Erweiterungs-UI. Viele Sites können verbunden sein, aber jede Site hat jeweils nur einen aktiven verbundenen Account.
