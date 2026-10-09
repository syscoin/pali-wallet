---
title: Erste Schritte für Benutzer
---

Pali ermöglicht es Ihnen, EVM-Konten, Syscoin-UTXO-Konten und modulare Smart Accounts in einer einzigen Erweiterung zu verwalten.

## Grundeinrichtung

1. Installieren Sie die Pali-Erweiterung.
2. Erstellen Sie eine neue Wallet oder importieren Sie eine vorhandene Seed-Phrase.
3. Legen Sie ein starkes Passwort fest.
4. Sichern Sie Ihre Seed-Phrase offline.
5. Wählen Sie das Netzwerk, das Sie verwenden möchten.
6. Verbinden Sie sich nur mit Dapps, denen Sie vertrauen.

## Einrichtung und Laden

Lassen Sie eine noch nicht abgeschlossene Einrichtung geöffnet und sichtbar. Wenn Sie sie verlassen, ausblenden oder neu laden, werden sensible Eingaben zur Einrichtung gelöscht, und Sie müssen möglicherweise von vorn beginnen. Bewahren Sie die gesicherte Wiederherstellungsphrase auf.

Falls Pali nicht bestätigen kann, dass die Wallet-Erstellung abgeschlossen wurde, lassen Sie die Anwendung neu laden und prüfen Sie die Wallet. Wenn der Entsperrbildschirm erscheint, verwenden Sie das gerade festgelegte Passwort. Gehen Sie bei einer unterbrochenen Antwort nicht davon aus, dass keine Wallet erstellt wurde, und wiederholen Sie die Erstellung nicht sofort.

Bei einem langsamen Vorgang kann Pali Wiederherstellungsoptionen anzeigen, während die Navigation verfügbar bleibt. Sicherheitsrelevante Aktionen warten weiterhin, bis Konto und Netzwerk feststehen. Unter Empfangen werden Adresse, QR-Code und Kopierfunktion vorübergehend ausgeblendet; auch Faucet-Anforderungen müssen warten. Prüfen Sie Konto und Netzwerk erneut, bevor Sie fortfahren.

## Verbindung mit einer Dapp

Wenn eine Website Zugriff anfordert, öffnet Pali ein Verbindungsfenster, das die Website anzeigt und Sie das Konto auswählen lässt. Eine Dapp erhält nur die Adresse des verbundenen Kontos und den freigegebenen Provider-Zustand.

Pali speichert Verbindungen pro Website. Sie können verschiedene Websites mit verschiedenen Konten verbinden, aber jede Website hat jeweils nur ein aktives Konto.

## EVM-Konten

Verwenden Sie EVM-Konten für Ethereum-kompatible Chains, Rollux, Syscoin NEVM und Dapps, die ein Wallet-Verhalten wie bei MetaMask erwarten.

EVM-Dapps können Folgendes anfordern:

- Kontozugriff
- Transaktionen
- persönliche Signaturen
- Signaturen für strukturierte Daten
- Anfragen zum Beobachten von Token
- Anfragen zum Hinzufügen oder Wechseln einer Chain
- Anfragen für gebündelte Aufrufe

Informationen zum Finden und Hinzufügen von Vermögenswerten finden Sie unter [Token-Erkennung und Explorer-APIs](./token-discovery-and-explorer-apis). Die Anleitung behandelt den manuellen Import, unterstützte API-Formate, Netzwerkeinstellungen und die Zugriffsbeschränkungen der Anbieter.

## UTXO-Konten

Verwenden Sie UTXO-Konten für Syscoin UTXO und Bitcoin-artige Transaktionsabläufe. UTXO-Dapps können xpub-bezogene Zustandsdaten, Wechselgeldadressen, PSBT-Signaturen und das Senden von Transaktionen anfordern.

## Smart Accounts

Smart Accounts sind Vertragskonten, die von Modulen kontrolliert werden. Pali kann Konten erstellen, die von einem Passkey-Validator, einem von der Wallet kontrollierten ECDSA-Validator oder einer gemeinsam verwalteten Richtlinie kontrolliert werden. Sie eignen sich für Dapp-Onboarding, gebündelte Aktionen und Guardian-Recovery. Einige Smart Accounts sind bis zu ihrer ersten Deployment-Transaktion kontrafaktisch.
