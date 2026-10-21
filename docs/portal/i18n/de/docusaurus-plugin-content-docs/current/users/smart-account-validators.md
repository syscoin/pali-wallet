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

Pali unterstützt diese Validator-Arten:

- **Passkey:** Der Browser oder das Betriebssystem fordert eine WebAuthn-Freigabe an.
- **ECDSA:** Konfigurierte EVM-Inhaberadressen geben Kontoaktionen frei.
- **SLH-DSA:** Der lokale Post-Quanten-Signer von Pali gibt Aktionen mithilfe seines verschlüsselten Signierzustands frei. Hinweise zu Backups und den Grenzen des Signaturzählers finden Sie unter [Post-Quanten-Signer](./post-quantum-signer).
- **Composite:** Untergeordnete Validatoren, etwa Passkey oder ECDSA, werden mit einem Schwellenwert kombiniert.

Validatoren beantworten die Frage „Wer darf Aktionen für dieses Konto freigeben?“ Das Nützliche daran ist, dass sich die Antwort ändern kann, ohne dass sich Ihr Konto ändert:

- **Eine Freigabe** (1-of-N): Ein konfigurierter untergeordneter Validator muss zustimmen.
- **Ein Schwellenwert an Freigaben** (t-of-N): Mindestens die konfigurierte Anzahl untergeordneter Validatoren muss zustimmen.
- **Alle Freigaben** (N-of-N): Alle konfigurierten untergeordneten Validatoren müssen zustimmen.

Pali sammelt Freigaben lokal verfügbarer integrierter untergeordneter Validatoren in der konfigurierten Reihenfolge, bis der Schwellenwert erreicht ist. Eine abgelehnte Freigabe beendet die Anfrage; Pali wechselt nach einer Ablehnung nicht stillschweigend zu einem anderen Signer. Eine Richtlinie muss genügend lokal signierfähige integrierte untergeordnete Validatoren behalten, um ihren Schwellenwert zu erreichen. Kompatible benutzerdefinierte Validatoren können optionale untergeordnete Validatoren sein, aber Pali sammelt für sie weder externe oder benutzerdefinierte Signaturen noch geräteübergreifende Freigaben. Verschachtelte Composite-Richtlinien werden in dieser Version nicht unterstützt.

Der Composite-Richtlinieneditor benötigt mindestens zwei installierte Validatoren. Der geführte Wechsel der Freigabemethode ersetzt den bisherigen Validator. Der aktuelle erweiterte Ablauf **Benutzerdefinierter Validator** kann zusätzliche kompatible Validatoren beibehalten, erfordert jedoch die korrekten Initialisierungsdaten des Moduls; er ist keine einfache Einrichtung geräteübergreifender Freigaben.

Ein Validatorwechsel ändert weder die Smart-Account-Adresse noch Guthaben oder Verlauf. Der Zugriff auf einen lokalen Signer setzt weiterhin voraus, dass sein Schlüssel oder Passkey verfügbar ist. Ein Richtlinienwechsel stellt keinen fehlenden Signierzustand wieder her und koordiniert die SLH-DSA-Nutzung nicht zwischen wiederhergestellten Geräten.

Guardians sind eine separate, verzögerte Berechtigung und keine alltägliche Freigabemethode. Eine ausreichende Zahl von Guardian-Freigaben kann die Kontrolle über das Konto ändern. Wählen und schützen Sie Guardians entsprechend; die Wartezeit macht einen nicht vertrauenswürdigen Guardian nicht sicher.

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
  <figcaption>Wenn das Konto noch nicht bereitgestellt ist, beginnen die Smart-Account-Einstellungen mit der Registrierung. Danach stehen hier Freigabe- und Recovery-Optionen bereit.</figcaption>
</figure>

Werden lokale Wallet-Daten gelöscht oder wird Pali auf einem neuen Gerät installiert, lassen sich deterministische Pali Smart Accounts aus Wallet-Metadaten und der Chain-Konfiguration rekonstruieren. Konten mit Passkey-Validatoren benötigen weiterhin Zugriff auf die zugehörigen Passkey-Zugangsdaten, um Aktionen freizugeben.

Ein Passkey kann mehrere Smart Accounts kontrollieren. Pali trennt das Passkey-Profil von den Smart-Account-Metadaten jedes bereitgestellten Kontos.

## Guardian-Recovery

Pali verwendet für die Smart-Account-Wiederherstellung Guardians unter eigener Kontrolle. Ein Guardian ist eine EVM-Adresse, die der Nutzer unabhängig vom aktiven Validator kontrolliert, typischerweise eine Backup-EVM-Wallet, ein importiertes Konto oder eine Hardware-Wallet. On-chain kann ein Guardian jedoch **jedes Konto sein, das eine Signatur nachweisen kann**, einschließlich eines Vertragskontos. Solange das Konto funktioniert, kann der Nutzer über den Richtlinienbildschirm Guardians hinzufügen oder entfernen und die Wartezeit für die Wiederherstellung ändern.

Das Recovery-Modul prüft Guardian-Freigaben mit standardmäßiger Signaturprüfung: eine gewöhnliche ECDSA-Signatur für normale Adressen oder eine ERC-1271-Vertragssignaturprüfung, wenn die Guardian-Adresse selbst ein Vertrag ist. Ein Guardian kann daher ein weiterer Smart Account sein, auch einer, dessen eigene Signierrichtlinie ein Composite-, benutzerdefinierter oder künftiger Post-Quanten-Validator ist. Der Wiederherstellungsweg übernimmt dann das Signaturverfahren, das dieses Guardian-Konto durchsetzt. Die Sicherheit der Wiederherstellung ist damit nicht auf klassische ECDSA-Schlüssel beschränkt.

Die Guardian-Bildschirme von Pali können Freigaben von lokalen schlüsselbasierten Guardians (Wallet-, importierten oder Hardware-Konten) und lokalen Smart-Account-Guardians sammeln, für die Pali signieren kann, einschließlich SLH-DSA-Smart-Accounts. Ein Smart-Account-Guardian muss bereits on-chain bereitgestellt sein, um ERC-1271-Signaturprüfungen zu beantworten. Ein externer Guardian, der nicht als lokales Signierkonto in Pali verfügbar ist, benötigt weiterhin einen externen Wiederherstellungsablauf, um seine Freigabe zu erzeugen.

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

## Guardian-Recovery Schritt für Schritt {#guardian-recovery-guide}

Das Wiederherstellen lokaler Wallet-Einträge und der Wechsel der Kontokontrolle sind verschieden. Eine Seed-Wiederherstellung umgeht keinen installierten Validator. Guardian-Recovery ändert nach einer Wartezeit die Freigabemethode desselben Smart Accounts.

1. **Einrichten:** Öffnen Sie die Recovery-Einstellungen, solange Ihre aktuelle Freigabemethode funktioniert. Registrieren Sie das Konto zuerst, falls es noch nicht bereitgestellt ist. Wählen Sie einen separat kontrollierten Guardian und eine Wartezeit und bestätigen Sie die Einrichtung on-chain. Halten Sie den Gas-Zahler finanziert.
2. **Starten:** Wählen Sie bei Zugriffsverlust eine neue Freigabemethode, deren Kontrolle Sie nachweisen können. Der konfigurierte Guardian signiert die genaue Recovery-Absicht. Die Übermittlung benötigt Gas; sie wechselt die Kontrolle noch nicht.
3. **Warten und abschließen:** Die bisherige Freigabemethode bleibt aktiv, bis Recovery erfolgreich abgeschlossen ist. Kehren Sie nach der Wartezeit zum selben Konto und Netzwerk zurück. Nach der Wartezeit kann jeder den Abschluss der genauen, bereits von den Guardians genehmigten Wiederherstellung übermitteln, bevor sie abläuft. Danach kontrolliert die neue Methode dasselbe Konto; Adresse, Guthaben und Verlauf bleiben bestehen.

Nach dem Abschluss autorisiert die ersetzte aktive Methode dieses Konto nicht mehr. Löschen Sie alte Schlüssel oder Passkeys erst, wenn andere Konten und Netzwerke sie nicht mehr benötigen. Eine vor dem Abschluss abgelaufene Anfrage benötigt einen neuen Recovery-Versuch.

Neue Pali-Richtlinien bieten **3 oder 7 Tage** Wartezeit. **10 Minuten** sind nur auf bekannten Testnetzen verfügbar. Dies sind Pali-Einrichtungsoptionen, kein vertragsweiter Mindestwert. Bestehende On-Chain-Einstellungen gelten weiterhin. Die Wartezeit und das anschließende Zeitfenster zum Abschließen sind nicht identisch.

### Unerwartete Recovery stoppen

Wenn Sie die aktuelle Freigabemethode noch kontrollieren, wählen Sie in den Recovery-Einstellungen **Disable guardian recovery** (Guardian-Recovery deaktivieren). Prüfen Sie Konto und Netzwerk, bestätigen Sie und bezahlen Sie Gas. Die bestätigte Entfernung verwirft alle ausstehenden Recoveries, auch extern gestartete, und entfernt diesen Wiederherstellungsweg. Richten Sie danach vertrauenswürdige Guardians neu ein, wenn Sie ihn weiter nutzen möchten.

Die Entfernung muss vor dem unerwünschten Abschluss bestätigt sein; sie macht keine bereits abgeschlossene Recovery rückgängig. Bei unklarem Ergebnis prüfen Sie zuerst den On-Chain-Status. Ein Fehler, Timeout oder Schließen des Fensters hebt eine gesendete Transaktion nicht auf. Nicht blind erneut senden.

### Optionale E-Mail-Hinweise

Der Link in den Einstellungen führt zu **Sysnode Account → Recovery alerts**. Nutzen Sie eine verifizierte E-Mail-Adresse, verbinden Sie den bereitgestellten Smart Account auf einem unterstützten Netzwerk und signieren Sie die Anmeldung mit seiner aktuellen Freigabemethode. Prüfen Sie, dass die Überwachung aktiv ist. Das ist optional und unabhängig von der Guardian-Einrichtung; Sysnode erhält keine privaten Schlüssel und kann weder Gelder bewegen noch Recovery abbrechen.

Die Überwachung läuft auch bei geschlossenem Pali, hängt aber vom Dienst, dessen RPC und der E-Mail-Zustellung ab. Hinweise können verspätet eintreffen oder ausfallen; junge Chain-Beobachtungen können reorganisiert werden. Keine E-Mail beweist nicht, dass keine Recovery läuft. Prüfen Sie Hinweise im vertrauenswürdigen Wallet für das genaue Konto und Netzwerk.
