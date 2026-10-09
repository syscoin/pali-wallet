---
title: Smart Accounts erstellen und wiederherstellen
---

`wallet_prepareSmartAccount` erstellt einen Pali Smart Account für das Dapp-Onboarding. Pali leitet das Konto ab, stellt es über die konfigurierte Factory bereit, installiert bei Bedarf den gewünschten Validator, verbindet das Konto mit der anfragenden Dapp und schreibt dauerhafte Kontometadaten in den lokalen Wallet-Zustand.

Der lokale Wallet-Zustand bildet Smart Accounts ab, die Pali bedienen kann. Ein Smart Account kann von einem Passkey-Validator, einem ECDSA-Validator, einem Composite-Validator oder von nach der Erstellung installierten Guardian-Recovery-Modulen kontrolliert werden.

## Struktur von Smart Account und Factory

Das Smart-Account-System besteht aus folgenden Teilen:

- **Factory:** berechnet deterministische Adressen und stellt Konten mit anfänglichen Moduldaten bereit.
- **Smart Account:** führt Aufrufe aus, verfolgt installierte Module und fordert Validator-Module zur Freigabe von Signaturen auf.
- **Validatoren:** autorisieren Aktionen. Pali unterstützt ECDSA-, P-256-WebAuthn-Passkey- und Composite-Validatoren.
- **Executors:** ergänzen Kontofunktionen. Pali verwendet Guardian-Recovery als Executor-Modul.

Zu den Kontoparametern der Factory gehören:

| Parameter | Bedeutung |
| --- | --- |
| `salt` | Deterministischer Deployment-Salt, den Pali aus Wallet-Anker, Kontoindex, Chain und Kontoversion ableitet. |
| `initialValidator` | Validator-Modul für das Bootstrap-Deployment. Pali verwendet einen von der Wallet kontrollierten ECDSA-Validator für die deterministische Einrichtung. |
| `initData` | Kodierte Initialisierungsdaten des Validators. |

Nach dem Deployment kann Pali den angeforderten Validator installieren und den Bootstrap-Validator in einem einzigen Smart-Account-Batch entfernen. Deshalb kann eine Dapp ein von einem Passkey kontrolliertes Konto anfordern, während der erste Deployment-Pfad in Pali deterministisch bleibt.

## Ein von einem Passkey kontrolliertes Konto erstellen

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

Wenn die Dapp `authenticator` weglässt, verwendet Pali standardmäßig den Passkey-Pfad. Verwenden Sie eine Anfrage nur mit der ID, zum Beispiel `{ id: 'p256-webauthn' }`, und überlassen Sie Pali die Auswahl oder Erstellung des von der Wallet kontrollierten Passkeys. Für externe ECDSA-Inhaber gilt weiterhin der unten beschriebene Ablauf mit ausdrücklicher Bestätigung.

## Einen ECDSA Smart Account erstellen

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Team account',
      authenticator: {
        id: 'ecdsa',
        config: {
          owners: ['0xOwnerAddress'],
          threshold: 1,
        },
      },
    },
  ],
});
```

ECDSA-Inhaber, die bereits lokale Pali-Wallet-Konten sind, gelten als von der Wallet kontrolliert. Externe ECDSA-Inhaberadressen sind nur nach einer ausdrücklichen Warnung und Bestätigung zulässig, weil diese Adressen künftige Smart-Account-Aktionen freigeben können.

## Verhalten bei Erstellung und Deployment

Wenn eine Dapp einen Smart Account anfordert:

1. Pali prüft, ob die Pali-Smart-Account-Infrastruktur für die aktive Chain konfiguriert ist.
2. Pali leitet den nächsten deterministischen Kontodeskriptor und die kontrafaktische Adresse ab.
3. Pali erstellt oder normalisiert den angeforderten Authenticator.
4. Pali zeigt den Host der Dapp, die Kontobezeichnung, den Authenticator-Typ und etwaige externe ECDSA-Inhaber an.
5. Pali erstellt das Konto lokal und stellt es on-chain mit dem Bootstrap-Validator bereit.
6. Unterscheidet sich der angeforderte Validator vom Bootstrap-Validator, installiert Pali den angeforderten Validator und deinstalliert den Bootstrap-Validator durch eine Smart-Account-Ausführung.
7. Pali wartet auf die Bestätigung, speichert dauerhafte Smart-Account-Metadaten und verbindet das Konto mit der Dapp.

Ist die resultierende Adresse bereits lokal vorhanden, kann Pali diesen lokalen Smart Account wiederverwenden.

## Was bestimmt die Adresse?

Die Smart-Account-Adresse wird aus der Factory, der Kontoimplementierung, den Initialisierungsdaten des Bootstrap-Validators und dem deterministischen Deployment-Salt von Pali abgeleitet. Pali leitet den Salt aus einem Wallet-Anker und dem Kontoindex ab. Dadurch lassen sich Konten anhand von Wallet-Metadaten statt anhand zufälliger lokaler Zustandsdaten wiederherstellen.

## Wenn der Nutzer lokale Pali-Daten verliert

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali-Einstellungen zur Wiederherstellung von Smart Accounts" />
</a>
  <figcaption>Der Wiederherstellungsbildschirm hilft, den Smart-Account-Zugriff wiederherzustellen, indem von Pali erstellte Konten rekonstruiert werden oder der aktive Validator durch Guardian-Recovery ersetzt wird.</figcaption>
</figure>

Gehen das Browserprofil, der Erweiterungsspeicher oder die lokalen Smart-Account-Metadaten verloren, hängt die Wiederherstellung von den aktuellen Modulen des Kontos ab:

- Deterministische, von Pali erstellte Konten lassen sich aus Wallet-Anker, Chain, Kontoindex und Factory-Konfiguration rekonstruieren.
- Passkey-Validatoren benötigen weiterhin die zugehörigen WebAuthn-Zugangsdaten, um künftige Aktionen zu autorisieren.
- Guardian-Recovery kann den aktiven Validator nach der konfigurierten Verzögerung ersetzen, wenn das ursprüngliche Freigabeverfahren nicht verfügbar ist.

Die Pali-Wiederherstellung bleibt unter Ihrer eigenen Kontrolle. Sie ist keine serverseitige Hintertür und kann die installierten Module des Kontos nicht umgehen.

## RP ID und Name der Zugangsdaten

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Passkey-Assertion im Browser oder Betriebssystem" />
</a>
  <figcaption>Wiederherstellung und Ausführung erfordern eine WebAuthn-Assertion der zugehörigen Passkey-Zugangsdaten.</figcaption>
</figure>

Der Browser bestimmt die effektive RP ID für WebAuthn am Origin der Erweiterung, sofern der Wallet-Ablauf keine RP ID vorgibt. Pali bezeichnet die standardmäßigen gemeinsamen Zugangsdaten als `Pali Wallet Passkey` und verwendet die angeforderte Kontobezeichnung für die für Nutzer sichtbare Zuordnung zum Konto.
