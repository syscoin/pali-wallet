---
title: Erste Schritte für Benutzer
---

Mit Pali können Sie EVM-Accounts, Syscoin UTXO-Accounts und Passkey Smart Accounts aus einer Erweiterung verwalten.

## Grundeinrichtung

1. Installieren Sie die Pali-Erweiterung.
2. Erstellen Sie eine neue Wallet oder importieren Sie eine vorhandene Seed-Phrase.
3. Legen Sie ein starkes Passwort fest.
4. Sichern Sie Ihre Seed-Phrase offline.
5. Wählen Sie das Netzwerk, das Sie verwenden möchten.
6. Verbinden Sie sich nur mit dapps, denen Sie vertrauen.

## Verbindung mit einer dapp

Wenn eine Site Zugriff anfordert, öffnet Pali ein Verbindungspopup, das die Site zeigt und Sie den Account auswählen lässt. Eine dapp erhält nur die verbundene Account-Adresse und den freigegebenen Provider-Zustand.

Pali speichert Verbindungen nach Site. Sie können verschiedene Sites mit verschiedenen Accounts verbinden, aber jede Site hat jeweils nur einen aktiven Account.

## EVM-Accounts

Verwenden Sie EVM-Accounts für Ethereum-kompatible Chains, Rollux, Syscoin NEVM und dapps, die Wallet-Verhalten im MetaMask-Stil erwarten.

EVM-dapps können Folgendes anfordern:

- Account-Zugriff
- Transaktionen
- persönliche Signaturen
- typed data-Signaturen
- Token-Watch-Requests
- Chain-Add/Switch-Requests
- Batch-Call-Requests

## UTXO-Accounts

Verwenden Sie UTXO-Accounts für Syscoin UTXO und Bitcoin-artige Transaktions-Flows. UTXO-dapps können xpub-bewussten Zustand, Wechselgeldadressen, PSBT-Signatur und Transaktions-Broadcast anfordern.

## Passkey Smart Accounts

Passkey-Accounts sind Smart Accounts, die durch WebAuthn-Credentials kontrolliert werden. Sie können für institutionell verwaltetes Onboarding, Account-Wiederherstellung und gesponserte Ausführung nützlich sein. Einige Passkey-Accounts sind counterfactual bis zu ihrer ersten Deployment-Transaktion.
