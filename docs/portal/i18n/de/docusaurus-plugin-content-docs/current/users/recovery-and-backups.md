---
title: Wiederherstellung und Backups
---

Backups sind wichtig, weil Pali non-custodial ist. Die Wallet kann eine Seed-Phrase, ein Passwort, einen privaten Schlüssel oder ein Passkey-Authenticator-Secret nicht für Sie wiederherstellen.

## Seed-Phrase-Backup

Schreiben Sie Ihre Wallet-Seed-Phrase auf und bewahren Sie sie offline auf. Jeder, der die Seed-Phrase besitzt, kann die abgeleiteten Accounts kontrollieren.

## Passkey-Backup-Status

Passkeys können gerätegebunden sein oder vom Plattform-Account-Anbieter synchronisiert werden. Pali zeigt backupbezogenen Status an, sofern verfügbar, aber das genaue Verhalten hängt vom Authenticator, Browser und Betriebssystem ab.

Sie können einen Status sehen, der nahelegt, ob ein Passkey gerätegebunden, backupfähig oder gesichert/synchronisiert ist. Ein synchronisierter Passkey ist in der Regel bequemer, weil er Ihnen über einen Plattform-Account wie Apple, Google oder Microsoft folgen kann. Ein gerätegebundener Passkey oder Hardware-Sicherheitsschlüssel kann strenger sein, aber der Verlust dieses Geräts kann die Wiederherstellung erschweren.

| Status, den Sie sehen können | Bedeutung | Komfort | Sicherheitsabwägung | Gute Eignung |
| --- | --- | --- | --- | --- |
| Gesichert oder synchronisiert | Der Passkey scheint von einem Plattform-Passkey-Anbieter gespeichert zu sein und kann auf andere vertrauenswürdige Geräte synchronisiert werden. | Am höchsten. Sie können nach dem Ersetzen eines Telefons oder Laptops häufig wiederherstellen, indem Sie sich erneut beim Plattform-Account anmelden. | Das Passkey-Secret wird weiterhin durch das Plattform-Passkey-System geschützt, aber die Sicherheitsgrenze umfasst den Plattform-Account, den Account-Wiederherstellungsprozess und synchronisierte Geräte. | Alltags-Wallets, dapp-Accounts, institutionelles Onboarding und kleinere Guthaben. |
| Backupfähig | Der Authenticator meldet, dass der Passkey gesichert oder synchronisiert werden kann, aber er ist möglicherweise aktuell nicht synchronisiert. | Mittel bis hoch, abhängig davon, ob Synchronisierung aktiviert ist. | Zukünftige Plattform-Einstellungen können das Credential in Cloud-Synchronisierung verschieben. Prüfen Sie Anbieter- und Geräteeinstellungen, wenn dies für Sie wichtig ist. | Benutzer, die Wiederherstellungsflexibilität möchten, aber weiterhin prüfen möchten, ob Synchronisierung aktiv ist. |
| Gerätegebunden oder nicht gesichert | Der Passkey scheint an einen Authenticator oder ein Gerät gebunden zu sein. | Niedriger. Wenn das Gerät verloren geht und kein anderer Wiederherstellungspfad existiert, kann Wiederherstellung schwieriger oder unmöglich sein. | Stärkere Isolation, weil die Kontrolle in diesem Authenticator konzentriert ist statt in einem cloud-synchronisierten Account. | Größere Guthaben, Accounts mit höheren Sicherheitsanforderungen, Hardware-Sicherheitsschlüssel und Cold-Wallet-artige Nutzung. |
| Unbekannt oder nicht verfügbar | Browser, OS oder Authenticator haben nicht genügend Backup-Informationen offengelegt. | Unbekannt. | Nehmen Sie weder Cloud-Wiederherstellung noch gerätegebundene Isolation an. Behandeln Sie es als mehrdeutig, bis Sie die Authenticator-Einrichtung verifizieren. | Temporäre Nutzung, Tests oder Fälle, in denen Sie den Passkey-Anbieter unabhängig verifizieren können. |

Cloud-synchronisierte Passkeys sind für normale Nutzung weiterhin sicher: Der private Schlüssel wird nicht an Pali oder die dapp weitergegeben, WebAuthn bleibt origin-gebunden, und Benutzerverifikation wird weiterhin vom Plattform-Authenticator durchgeführt. Die Abwägung ist, dass der Plattform-Account Teil Ihres Wallet-Sicherheitsmodells wird. Für Cold Storage, Treasury-Funds oder große langfristige Guthaben sollten Sie einen gerätegebundenen Authenticator oder Hardware-Sicherheitsschlüssel bevorzugen und nur kleinere operative Mittel in synchronisierten Passkey-Accounts halten.

Backup-Status ist ein Signal, das Ihnen bei der Wahl zwischen Komfort und Sicherheit hilft. Er ersetzt nicht Ihr Seed-Phrase-Backup und bedeutet nicht, dass Pali oder eine Institution ein Passkey-Secret für Sie wiederherstellen kann.

## Passkey-Accounts wiederherstellen

Pali-Passkey-Wiederherstellung nutzt wallet-bezogene Wiederherstellungsmetadaten und on-chain Account-Discovery. Der Wiederherstellungs-Flow:

1. Fordert eine discoverable WebAuthn-Assertion an.
2. Sucht passende Smart Accounts aus der Factory-Registry und Erstellungs-Logs.
3. Überspringt Accounts, die bereits in der Wallet sind.
4. Fügt wiederherstellbare Accounts hinzu, wenn Sponsor-Metadaten aufgelöst werden können.
5. Warnt, wenn Sponsor-URL-Metadaten für eine erforderliche Sponsor-Policy benötigt werden.

## Idempotenz bei dapp-Erstellung/Wiederherstellung

Wenn eine dapp `wallet_prepareSmartAccount` aufruft, prüft Pali zuerst, ob ein vorhandener on-chain Passkey-Account zur angeforderten Sponsor-Policy passt. Wenn der passende Account bereits lokal existiert, verwendet Pali ihn wieder, statt ein Duplikat zu erstellen. Wenn er on-chain existiert, aber nicht lokal, kann Pali ihn in die Wallet wiederherstellen.
