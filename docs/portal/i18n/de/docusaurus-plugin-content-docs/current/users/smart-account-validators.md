---
title: Smart Accounts und Validatoren
---

Pali Smart Accounts sind EVM-Vertragskonten, die von Modulen kontrolliert werden können. Ein Passkey ist eine unterstützte Möglichkeit, einen Smart Account zu kontrollieren. Statt jede Aktion mit einem normalen privaten EOA-Schlüssel zu signieren, kann der Nutzer Aktionen über die Passkey-Oberfläche des Browsers oder Betriebssystems freigeben.

Im Hintergrund verwenden WebAuthn-Passkeys P-256-Signaturen. Der Passkey-Validator von Pali ist so aufgebaut, dass diese P-256-Nachweise vom Smart Account geprüft werden können. Deshalb kann eine biometrische oder plattformseitige Passkey-Freigabe eine On-chain-Aktion autorisieren, ohne den privaten Passkey-Schlüssel gegenüber Pali oder der Dapp offenzulegen.

## Warum einen Smart Account verwenden?

- Modulare Freigabeverfahren für den Alltag.
- Kontrolle durch einen von der Wallet kontrollierten ECDSA-Validator, wenn ein normaler Wallet-Schlüssel das Konto kontrollieren soll.
- Gemeinsam verwaltete Richtlinien durch Composite-Validatoren.
- Gebündelte Ausführung mit einer einzigen Nutzerfreigabe.
- Guardian-Recovery nach einer Zeitsperre.
- Deterministische Kontoerstellung, damit Pali Kontodatensätze rekonstruieren kann.

## Passkeys, ECDSA und gemeinsam verwaltete Konten

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali-Einstellungen zum Erstellen eines Smart Accounts" />
</a>
  <figcaption>Nutzer können modulare Smart Accounts über die Einstellungen oder per Dapp-Anfrage erstellen und anschließend den Validator auswählen, der Freigaben kontrolliert.</figcaption>
</figure>

Pali unterstützt drei Validator-Arten:

- **Passkey:** Der Browser oder das Betriebssystem fordert eine WebAuthn-Freigabe an.
- **ECDSA:** Konfigurierte EVM-Inhaberadressen geben Kontoaktionen frei.
- **Composite:** Untergeordnete Validatoren, etwa Passkey oder ECDSA, werden mit einem Schwellenwert kombiniert.

Validatoren beantworten die Frage „Wer darf Aktionen für dieses Konto freigeben?“ Das Nützliche daran ist, dass sich die Antwort ändern kann, ohne dass sich Ihr Konto ändert:

- **Eine beliebige meiner Anmeldungen** (1-of-N): Freigabe mit dem Passkey oder Schlüssel, der gerade zur Hand ist.
- **Einige von uns gemeinsam** (t-of-N): Ein Quorum von Personen oder Geräten muss zustimmen; ideal für gemeinsame Gelder.
- **Alle von uns gemeinsam** (N-of-N): Jede konfigurierte Anmeldung muss freigeben, für die sensibelsten Konten.

Richtlinien können sogar andere Richtlinien enthalten. So kann ein Team beispielsweise „den Schlüssel der Teamleitung plus zwei beliebige Desk-Passkeys“ festlegen. Ihre Adresse, Guthaben und Ihr Verlauf bleiben bei einer Richtlinienänderung unverändert. Da das Signieren modular ist, lassen sich künftig neue Signaturtypen, einschließlich Post-Quanten-Verfahren, auf demselben Konto verwenden.

Guardians sind bewusst **nicht** Teil dieser Liste. Ein Guardian kann niemals eine Transaktion freigeben; seine einzige Befugnis besteht darin, eine langsame, sichtbare Wiederherstellung zu starten, wenn Sie den Zugriff verlieren. Diese Trennung schützt vor Zugriffsverlust, ohne jemandem die alltägliche Kontrolle zu geben.

Pali kann ein gemeinsames Wallet-Passkey-Profil verwenden oder separate Passkey-Zugangsdaten für ein Konto erstellen. Gemeinsame Passkeys sind praktisch für Nutzer, die einen einzigen von der Wallet kontrollierten Passkey wünschen. Separate Passkeys können Zugangsdaten pro Dienst oder Richtlinie voneinander isolieren.

## Deployment

Ein Smart Account kann als kontrafaktische Adresse existieren, während Pali seine Erstellung vorbereitet. Pali leitet die Adresse aus deterministischen Factory-Eingaben ab, führt das Deployment über die Pali-Factory aus und speichert dauerhafte Kontometadaten lokal.

Das Konto startet für das deterministische Deployment mit einem von der Wallet kontrollierten Bootstrap-Validator. Hat der Nutzer oder die Dapp einen Passkey oder einen anderen Validator gewählt, installiert Pali diesen Validator und entfernt den Bootstrap-Validator durch eine Smart-Account-Ausführung.

## Netzwerkunterstützung

Smart Accounts setzen voraus, dass die Pali-Factory und Modulverträge an den Adressen vorhanden sind, die Pali für die aktive Chain verwendet. In diesem Pali-Build ist das Testnet `zkTanenbaum` für die Erstellung von Smart Accounts konfiguriert. Die Produktionsunterstützung für zkSYS verwendet dasselbe Modell, sobald die Adressen der Produktions-Factory und Module konfiguriert sind.

Andere kompatible EVM-Chains können dieselben Verträge verwenden. Unterstützt das aktive Netzwerk den kanonischen CREATE2-Deployer, kann Pali die fehlende Smart-Account-Infrastruktur direkt aus der Wallet bereitstellen: Öffnen Sie Einstellungen, dann Erweitert, und verwenden Sie die Schaltfläche zum Bereitstellen unter **Smart-Account-Einrichtung**. Passkey-Validatoren benötigen Unterstützung für P-256-WebAuthn-Verifikation, die viele moderne EVM-Umgebungen über einen P-256-/Passkey-Precompile anbieten.

### Ausstehende Einrichtung

Eine langsame Einrichtung bietet die Aktion **Status prüfen**. Das Verlassen der Seite oder Wechseln des Netzwerks bricht eine bereits gesendete Transaktion nicht ab. Kehren Sie zum ursprünglichen Netzwerk zurück und prüfen Sie dort den Einrichtungsstatus, bevor Sie ein weiteres Deployment versuchen. Eine Zeitüberschreitung oder ausbleibende Antwort beweist nicht, dass nichts bereitgestellt wurde.

## Wiederherstellung

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali-Einstellungen für Smart-Account-Richtlinien" />
</a>
  <figcaption>Der Richtlinienbildschirm des Smart Accounts zeigt installierte Module, Details zum aktiven Validator, Guardian-Recovery und Modulverwaltung.</figcaption>
</figure>

Werden lokale Wallet-Daten gelöscht oder wird Pali auf einem neuen Gerät installiert, lassen sich deterministische Pali Smart Accounts aus Wallet-Metadaten und der Chain-Konfiguration rekonstruieren. Konten mit Passkey-Validatoren benötigen weiterhin Zugriff auf die zugehörigen Passkey-Zugangsdaten, um Aktionen freizugeben.

Ein Passkey kann mehrere Smart Accounts kontrollieren. Pali trennt das Passkey-Profil von den Smart-Account-Metadaten jedes bereitgestellten Kontos.

## Guardian-Recovery

Pali verwendet für die Smart-Account-Wiederherstellung Guardians unter eigener Kontrolle. Ein Guardian ist eine EVM-Adresse, die der Nutzer unabhängig vom aktiven Validator kontrolliert, typischerweise eine Backup-EVM-Wallet, ein importiertes Konto oder eine Hardware-Wallet. On-chain kann ein Guardian jedoch **jedes Konto sein, das eine Signatur nachweisen kann**, einschließlich eines Vertragskontos. Solange das Konto funktioniert, kann der Nutzer über den Richtlinienbildschirm Guardians hinzufügen oder entfernen und die Wartezeit für die Wiederherstellung ändern.

Das Recovery-Modul prüft Guardian-Freigaben mit standardmäßiger Signaturprüfung: eine gewöhnliche ECDSA-Signatur für normale Adressen oder eine ERC-1271-Vertragssignaturprüfung, wenn die Guardian-Adresse selbst ein Vertrag ist. Ein Guardian kann daher ein weiterer Smart Account sein, auch einer, dessen eigene Signierrichtlinie ein Composite-, benutzerdefinierter oder künftiger Post-Quanten-Validator ist. Der Wiederherstellungsweg übernimmt dann das Signaturverfahren, das dieses Guardian-Konto durchsetzt. Die Sicherheit der Wiederherstellung ist damit nicht auf klassische ECDSA-Schlüssel beschränkt.

Eine aktuelle Einschränkung: Die Guardian-Bildschirme von Pali sammeln derzeit Freigaben von Guardians mit Schlüsseln, also Wallet-, importierten oder Hardware-Konten. Guardians in Form von Vertragskonten werden vom bereitgestellten Recovery-Modul vollständig unterstützt. Die Erstellung ihrer ERC-1271-Freigabe ist jedoch noch kein geführter Pali-Ablauf. Außerdem muss ein solcher Guardian bereits on-chain bereitgestellt sein, um Signaturprüfungen zu beantworten. Diese Flexibilität ist bereits im Kontomodell angelegt, sodass die Wallet solche Guardian-Typen künftig unterstützen kann, ohne das Konto erneut bereitzustellen oder zu ändern.

Guardian-Recovery erfolgt nicht sofort. Beim Start wird ein Ersatzziel für die Wiederherstellung erstellt, der konfigurierte Guardian wird zur Signatur der Wiederherstellungsabsicht aufgefordert und ein zeitgesperrter Wiederherstellungsantrag wird gesendet. Nach Ablauf der Wartezeit kann jeder die Wiederherstellungstransaktion abschließen. Danach kann der Nutzer das Konto mit dem Ersatzvalidator verwenden.

Die Guardian-Signatur bindet die Chain, die Kontoadresse, das Recovery-Modul, den Recovery-Salt, den Ausführungsmodus und die Recovery-Calldata. Pali verwendet für jeden Wiederherstellungsversuch einen neuen Salt, und das Modul erlaubt nur eine aktive Wiederherstellung pro Konto.

Technischer Hinweis: Der Guardian-Recovery-Executor speichert pro Konto eine Guardian-Menge, einen Schwellenwert, eine Verzögerung, einen Ablaufzeitpunkt und eine ausstehende Wiederherstellung. Pali bietet derzeit einfache Guardian-Abläufe für eine verständliche Bedienung an, während das Modul Schwellenwertrichtlinien wie 1-of-N oder M-of-N unterstützt.

## Von Dapps erstellte Konten

Dapps können mit `wallet_prepareSmartAccount` einen Smart Account anfordern:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "p256-webauthn"
  }
}
```

Dapps können auch einen ECDSA-Validator anfordern:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "ecdsa",
    "config": {
      "owners": ["0x..."],
      "threshold": 1
    }
  }
}
```

Ist der angeforderte ECDSA-Inhaber kein lokales Pali-Konto, zeigt Pali eine Warnung an und verlangt vor dem Fortfahren eine ausdrückliche Bestätigung.

## Referenzen zu Standards

Pali Smart Accounts basieren auf öffentlichen Smart-Account-Standards:

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337) für Kontoausführung im Stil von UserOperations.
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579) für Validator- und Executor-Module.
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271) für Signaturen von Vertragskonten.
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) für Passkey-Freigaben.
