---
title: Wiederherstellung und Backups
---

Backups sind wichtig, weil Pali nicht verwahrend ist. Die Wallet kann eine Seed-Phrase, ein Passwort, einen privaten Schlüssel oder das Geheimnis eines Passkey-Authenticators nicht für Sie wiederherstellen.

## Seed-Phrase-Backup

Schreiben Sie die Seed-Phrase Ihrer Wallet auf und bewahren Sie sie offline auf. Jeder, der die Seed-Phrase besitzt, kann die daraus abgeleiteten Konten kontrollieren.

## Entsperren und Passkey-Änderungen

Ein nicht verfügbarer Browserdienst, ein Speicherproblem oder eine nicht unterstützte Kryptografiefunktion kann das Entsperren verhindern, ohne dass Ihr Passwort falsch ist. Lesen Sie die Fehlermeldung, stellen Sie den erforderlichen Dienst oder die Verbindung wieder her und versuchen Sie erneut, die Wallet zu entsperren. Löschen oder importieren Sie die Wallet nicht erneut, um einen Betriebsfehler zu umgehen. Betriebsfehler zählen nicht als fehlgeschlagene Passwortversuche.

Beim Ersetzen eines Passkeys können sowohl der bisherige als auch der neue Passkey verfügbar bleiben. Der bisherige Passkey kann weiterhin eine andere Chain oder eine gemeinsam genutzte Richtlinie kontrollieren. Löschen Sie keinen der beiden Passkeys, nur weil die Einrichtung abgebrochen wurde oder fehlgeschlagen ist. Prüfen Sie zuerst, welche Passkeys die betroffenen Konten weiterhin benötigen. Bewahren Sie die aktuellen Wallet-Daten auf, während Sie eine unterbrochene Änderung untersuchen.

## Passkey-Backup-Status

Passkeys können gerätegebunden sein oder vom Anbieter des Plattformkontos synchronisiert werden. Pali zeigt Informationen zum Backup-Status an, sofern verfügbar. Das genaue Verhalten hängt jedoch vom Authenticator, Browser und Betriebssystem ab.

Möglicherweise sehen Sie einen Status, der darauf hinweist, ob ein Passkey gerätegebunden, backupfähig oder gesichert beziehungsweise synchronisiert ist. Ein synchronisierter Passkey ist in der Regel bequemer, weil er Ihnen über ein Plattformkonto wie Apple, Google oder Microsoft auf andere Geräte folgen kann. Ein gerätegebundener Passkey oder Hardware-Sicherheitsschlüssel kann strengere Grenzen setzen, aber der Verlust dieses Geräts kann die Wiederherstellung erschweren.

| Angezeigter Status | Bedeutung | Komfort | Sicherheitsabwägung | Geeignet für |
| --- | --- | --- | --- | --- |
| Gesichert oder synchronisiert | Der Passkey scheint bei einem Plattform-Passkey-Anbieter gespeichert zu sein und kann mit anderen vertrauenswürdigen Geräten synchronisiert werden. | Am höchsten. Nach dem Ersetzen eines Telefons oder Laptops lässt sich der Zugriff häufig durch erneute Anmeldung beim Plattformkonto wiederherstellen. | Das Passkey-Geheimnis wird weiterhin vom Passkey-System der Plattform geschützt, aber die Sicherheitsgrenze umfasst das Plattformkonto, dessen Wiederherstellungsverfahren und synchronisierte Geräte. | Alltags-Wallets, Dapp-Konten, institutionelles Onboarding und kleinere Guthaben. |
| Backupfähig | Der Authenticator meldet, dass der Passkey gesichert oder synchronisiert werden kann, aber derzeit möglicherweise nicht synchronisiert wird. | Mittel bis hoch, je nachdem, ob die Synchronisierung aktiviert ist. | Künftige Plattformeinstellungen können die Zugangsdaten in die Cloud-Synchronisierung aufnehmen. Prüfen Sie Anbieter- und Geräteeinstellungen, wenn dies für Sie wichtig ist. | Nutzer, die flexible Wiederherstellung wünschen, aber dennoch prüfen möchten, ob die Synchronisierung aktiv ist. |
| Gerätegebunden oder nicht gesichert | Der Passkey scheint an einen einzelnen Authenticator oder ein Gerät gebunden zu sein. | Geringer. Geht das Gerät verloren und gibt es keinen anderen Wiederherstellungsweg, kann die Wiederherstellung schwieriger oder unmöglich sein. | Stärkere Isolation, weil die Kontrolle bei diesem Authenticator statt bei einem cloud-synchronisierten Konto liegt. | Größere Guthaben, Konten mit hohen Sicherheitsanforderungen, Hardware-Sicherheitsschlüssel und eine Nutzung ähnlich einer Cold Wallet. |
| Unbekannt oder nicht verfügbar | Browser, Betriebssystem oder Authenticator haben nicht genügend Backup-Informationen bereitgestellt. | Unbekannt. | Gehen Sie weder von Cloud-Wiederherstellung noch von gerätegebundener Isolation aus. Behandeln Sie den Status als unklar, bis Sie die Authenticator-Einrichtung überprüft haben. | Vorübergehende Nutzung, Tests oder Fälle, in denen Sie den Passkey-Anbieter unabhängig überprüfen können. |

Cloud-synchronisierte Passkeys sind für die normale Nutzung weiterhin sicher: Der private Schlüssel wird weder Pali noch der Dapp übergeben, WebAuthn bleibt an den Origin gebunden, und die Benutzerverifikation wird weiterhin vom Authenticator der Plattform durchgeführt. Die Abwägung besteht darin, dass das Plattformkonto Teil des Sicherheitsmodells Ihrer Wallet wird. Bevorzugen Sie für Cold Storage, Treasury-Mittel oder große langfristige Guthaben einen gerätegebundenen Authenticator oder Hardware-Sicherheitsschlüssel und halten Sie nur kleinere operative Beträge auf Konten, die von synchronisierten Passkeys kontrolliert werden.

Der Backup-Status hilft Ihnen bei der Wahl zwischen Komfort und Sicherheit. Er ersetzt weder das Backup Ihrer Seed-Phrase noch bedeutet er, dass Pali oder eine Institution ein Passkey-Geheimnis für Sie wiederherstellen kann.

## Smart Accounts wiederherstellen

Die Wiederherstellung von Pali Smart Accounts hängt von den installierten Modulen ab. Ein von einem Passkey kontrolliertes Konto benötigt die zugehörigen WebAuthn-Zugangsdaten, um künftige Aktionen freizugeben. Ein Guardian-Recovery-Modul kann den aktiven Validator nach der konfigurierten Zeitsperre ersetzen, wenn die erforderliche Anzahl von Guardians die Wiederherstellungsabsicht signiert. Der Wiederherstellungsablauf kann:

1. Deterministische Pali-Kontodatensätze aus Wallet-Metadaten rekonstruieren.
2. Eine WebAuthn-Assertion anfordern, wenn ein Passkey-Validator die Kontrolle nachweisen muss.
3. Guardian-Recovery verwenden, wenn der aktive Validator ersetzt werden muss.
4. Konten überspringen, die bereits in der Wallet vorhanden sind.
5. Wiederherstellbare Konten mit Hinweisen zu Guthaben und Aktivitäten anzeigen, soweit verfügbar.
6. Die vom Nutzer ausgewählten Konten importieren.

## Dapp-Erstellung und Wallet-Wiederherstellung

Wenn eine Dapp `wallet_prepareSmartAccount` aufruft, erstellt Pali einen Smart Account und speichert dauerhafte Metadaten lokal, nachdem das Deployment und die gegebenenfalls angeforderte Validator-Einrichtung abgeschlossen sind. Pali bewahrt außerdem lokale Datensätze einer ausstehenden Passkey-Einrichtung bereits vor der Installation auf, damit eine unterbrochene Änderung diese Wiederherstellungsdetails nicht unbemerkt verwirft. Diese Datensätze ersetzen weder ein Seed-Backup noch den Zugriff auf den Passkey.

Existiert ein Smart Account on-chain, fehlt aber lokal, verwenden Sie die Wallet-Wiederherstellung von Pali. Pali überspringt bereits lokal vorhandene Konten und lässt den Nutzer auswählen, welche übrigen Konten importiert werden sollen.
