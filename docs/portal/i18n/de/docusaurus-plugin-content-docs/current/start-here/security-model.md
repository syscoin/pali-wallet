---
title: Sicherheitsmodell
---

Pali ist eine non-custodial Wallet. Sie gibt keine privaten Schlüssel an dapps weiter. dapps senden Requests an den injizierten Provider, Pali validiert und routet diese Requests, und Benutzer bestätigen sensible Aktionen in der Erweiterungs-UI.

## Kernprinzipien

- **Origin-begrenzte Verbindungen:** Verbindungen werden pro dapp-Host gespeichert.
- **Ein aktiver Account pro dapp:** Eine verbundene Site hat jeweils einen aktiven Account, auch wenn viele Sites verbunden sein können.
- **Serialisierte Freigaben:** Blockierende Requests, die Popups öffnen, werden koordiniert, damit Benutzer nicht unter konkurrierenden Freigaben begraben werden.
- **Netzwerkfamilien-Prüfungen:** EVM-Methoden und UTXO-Methoden sind getrennt. Aufrufe in der falschen Familie sollten als behebbare dapp-Fehler behandelt werden.
- **Explizite Signatur:** Transaktionen, PSBTs, typed data, Nachrichtensignaturen, Passkey-Erstellung, Passkey-Ausführungen, Asset-Watch-Requests und Chain-Änderungen erfordern den richtigen Wallet-Zustand und Benutzerfreigabe.
- **Provider-Isolation:** Pali injiziert Provider in die Top-Level-Seite. Es injiziert nicht in iframes.

## Was dapps erhalten

dapps erhalten öffentliche Account-Identifikatoren, Provider-Zustand, Signaturen, Transaktions-Hashes und explizite RPC-Ergebnisse. Sie erhalten niemals Seed-Phrasen, private Schlüssel, privates Passkey-Material oder Authenticator-Secrets.

## Passkey-Sicherheit

Passkey Smart Accounts verwenden WebAuthn-Credentials. Pali speichert öffentliche Metadaten und Credential-Identifikatoren; privates Schlüsselmaterial verbleibt im Authenticator. Pali lehnt Cross-Origin-WebAuthn-Assertions ab und verifiziert, dass Passkey-Action-Hashes zum vorbereiteten Transaktionssatz passen.

## Sicherheit von Sponsor-Policies

Institutionelle Sponsor-Policy ist aufgeteilt in:

- **On-chain-Policy:** Modus, Sponsor-Signer und URL-Hash.
- **Wallet-Metadaten:** Sponsor-URL und angezeigter Policy-Text.

Das Feld `policyText` wird Benutzern als Kontext angezeigt. Es ist kein on-chain Enforcement-Primitiv.
