---
title: Datenschutz und Sicherheit
---

Pali ist darauf ausgelegt, zu minimieren, was dapps ohne explizite Benutzeraktion erfahren können.

## Was Pali nicht offenlegt

Pali legt gegenüber Webseiten keine Seed-Phrasen, privaten Schlüssel, privates Passkey-Material, Wallet-Passwörter oder uneingeschränkten Account-Listen offen.

## Was dapps anfordern können

dapps können öffentliche Account-Adressen, Provider-Zustand, Netzwerkzustand, Signaturen, Transaktionsfreigaben, PSBT-Signatur, Asset-Watch-Freigaben, Chain-Wechsel, Erstellung von Passkey-Accounts und Batch-Ausführung anfordern.

## Verbindungssicherheit

Verbinden Sie sich nur mit dapps, denen Sie vertrauen. Eine verbundene dapp kann den Account sehen, den Sie für diese Origin freigegeben haben, und zukünftige Aktionen anfordern. Sie können Site-Zugriff in der Wallet widerrufen.

## Öffentliche Blockchain-Daten

Blockchain-Aktivität ist öffentlich. Ihre Adresse, Transaktionshistorie, Token-Freigaben, UTXO-Aktivität, Smart-Account-Deployment und Passkey-Smart-Account-Aktivität können auf Explorern und Indexern sichtbar sein.

## Datenschutz bei institutionellen Passkeys

Wenn eine dapp oder Institution eine Sponsor-URL bereitstellt, kann dieser Service Sponsor-Requests erhalten, die mit Account-Ausführung zusammenhängen. Prüfen Sie den Policy-Text und die URL der Institution, bevor Sie freigeben.

## Private Notizen

Pali kann den Standard-Privatsphäredienst oder deinen eigenen Sysnode-Dienst verwenden. Weitere Informationen zum eigenen Dienst findest du in der [Sysnode-Anleitung](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

Standardmäßig können 128 Notizen gespeichert werden (bis zu 4 MiB). Unter **Notizkapazität** kannst du 256 (bis zu 8 MiB) oder 512 (bis zu 16 MiB) wählen. Höhere Limits können mehr lokalen Speicher benötigen und Tresorvorgänge verlangsamen. Die Änderung entfernt keine Notizen; ältere Wallet-Versionen können das aktualisierte Tresorformat möglicherweise nicht lesen.

Mit **Abgeschlossene Notizen entfernen** kannst du abgeschlossene Notizen prüfen und entfernen. Eine bekannte Auszahlung und eine gegebenenfalls gespeicherte zugehörige Einzahlung müssen final bestätigt sein; ungeprüfte Notizen bleiben gespeichert. Der ausgewählte Ethereum-RPC erhält den Auszahlungs-Hash und gegebenenfalls den zugehörigen Einzahlungs-Hash, sodass der Anbieter beide verknüpfen kann. Die Prüfung vertraut den Antworten dieses RPC.
