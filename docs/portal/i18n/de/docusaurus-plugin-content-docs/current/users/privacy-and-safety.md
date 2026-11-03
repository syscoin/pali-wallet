---
title: Datenschutz und Sicherheit
---

Pali ist darauf ausgelegt, zu minimieren, was dapps ohne explizite Benutzeraktion erfahren können.

## Was Pali nicht offenlegt

Pali legt gegenüber Webseiten keine Seed-Phrasen, privaten Schlüssel, privates Passkey-Material, Wallet-Passwörter oder uneingeschränkten Account-Listen offen.

## Was dapps anfordern können

dapps können öffentliche Account-Adressen, Provider-Zustand, Netzwerkzustand, Signaturen, Transaktionsfreigaben, PSBT-Signatur, Asset-Watch-Freigaben, Chain-Wechsel, Erstellung von Smart Accounts und Batch-Ausführung anfordern.

## Verbindungssicherheit

Verbinden Sie sich nur mit dapps, denen Sie vertrauen. Eine verbundene dapp kann den Account sehen, den Sie für diese Origin freigegeben haben, und zukünftige Aktionen anfordern. Sie können Site-Zugriff in der Wallet widerrufen.

## Öffentliche Blockchain-Daten

Blockchain-Aktivität ist öffentlich. Ihre Adresse, Transaktionshistorie, Token-Freigaben, UTXO-Aktivität, Smart-Account-Deployment und Smart-Account-Aktivität können auf Explorern und Indexern sichtbar sein.

## Netzwerkdienstanbieter

Ausgewählte RPC- und Blockbook-Anbieter erhalten die für deine Aktionen nötigen Kontoadressen und Transaktionsabfragen oder -übermittlungen. UTXO-Kontoabfragen können einen erweiterten öffentlichen Schlüssel (xpub) enthalten. Dienste für Tokensuche, Explorer, Preise, Netzwerkerkennung und Hardware-Unterstützung erhalten je nach Vorgang Anfragen. Diese Endpunkte können auch deine IP-Adresse und Anfragezeitpunkte sehen. Verbundene Dapps erhalten die von dir freigegebenen öffentlichen Konten und autorisierten Signaturen.

## Private Notizen

Diese Funktion nutzt vier feste Tornado-Classic-ETH-Pools (0,1, 1, 10 und 100 ETH) im Ethereum-Mainnet; sie macht gewöhnliche Wallet-Aktivitäten nicht privat. Für Einzahlung und direkte Auszahlung ist ein signierfähiges Software-HD- oder importiertes Konto nötig. Ein importiertes Nur-Beobachten-Konto kann den Kontext für eine Auszahlung über einen Relayer liefern; Hardware- und Smart Accounts werden für diese Vorgänge nicht unterstützt. Bei direkter Auszahlung sind Gaszahler und Empfänger öffentlich verknüpft. Ein Relayer hat eigene Gebühren und Vertrauensrisiken. Anonymität oder Post-Quanten-Privatsphäre wird nicht garantiert.

Eine private Notiz ist ein Inhabergeheimnis: Wer sie besitzt, kann auszahlen. Solange die Wallet entsperrt ist und du das Passwort kennst, wähle für jede gespeicherte Notiz **Für Backup anzeigen** und bewahre die Backups geheim und sicher auf. Die Wiederherstellungsphrase allein stellt erzeugte Notizen nach Wiederherstellung, Zurücksetzen oder Installationswechsel nicht wieder her.

Der Privatsphäredienst liefert öffentliche Pooldaten und das Relayer-Verzeichnis; der gewählte Ethereum-RPC und der Endpunkt eines ausgewählten Relayers sind getrennt davon. Standard ist `https://sysnode.info`. Die Einstellung akzeptiert einen HTTPS-Ursprung oder HTTP auf `localhost` bzw. `127.0.0.1`, ohne Pfad, Zugangsdaten, Query oder Fragment. Ein Dienstwechsel löscht vorbereitete öffentliche Pooldaten; bereite den Pool erneut vor. Gespeicherte Notizen bleiben erhalten. Anbieter können deine IP-Adresse und Anfragezeitpunkte sehen.

Pali kann den Standard-Privatsphäredienst oder deinen eigenen Sysnode-Dienst verwenden. Weitere Informationen zum eigenen Dienst findest du in der [Sysnode-Anleitung](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

Standardmäßig können 128 Notizen gespeichert werden (bis zu 4 MiB). Unter **Notizkapazität** kannst du 256 (bis zu 8 MiB) oder 512 (bis zu 16 MiB) wählen. Höhere Limits können mehr lokalen Speicher benötigen und Tresorvorgänge verlangsamen. Die Änderung entfernt keine Notizen; ältere Wallet-Versionen können das aktualisierte Tresorformat möglicherweise nicht lesen.

Mit **Abgeschlossene Notizen entfernen** kannst du abgeschlossene Notizen prüfen und entfernen. Eine bekannte Auszahlung und eine gegebenenfalls gespeicherte zugehörige Einzahlung müssen final bestätigt sein; ungeprüfte Notizen bleiben gespeichert. Der ausgewählte Ethereum-RPC erhält den Auszahlungs-Hash und gegebenenfalls den zugehörigen Einzahlungs-Hash, sodass der Anbieter beide verknüpfen kann. Die Prüfung vertraut den Antworten dieses RPC.

Du kannst das Limit nicht unter die Anzahl gespeicherter Notizen senken. Einer als ausgegeben angezeigten Notiz können die lokal gespeicherte Auszahlung und der für das Entfernen nötige Transaktions-Hash fehlen; sie bleibt dann gespeichert. Die Prüfung erfolgt einzeln. Bei einer Unterbrechung können frühere Löschungen bereits abgeschlossen sein. Aktualisiere nach einem Fehler die Liste, bevor du es erneut versuchst.

## Datenschutz bei Smart Accounts

Module und Ausführungen von Smart Accounts sind öffentlich auf der Blockchain. Wenn eine dapp die Installation eines ECDSA-Eigentümers oder eines Wiederherstellungsmoduls anfordert, prüfe vor der Freigabe die Eigentümeradressen und Wiederherstellungseinstellungen.
