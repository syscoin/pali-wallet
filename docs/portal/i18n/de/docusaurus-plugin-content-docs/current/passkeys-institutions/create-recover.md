---
title: Passkey-Accounts erstellen und wiederherstellen
---

`wallet_createPasskeyAccount` ist für dapp-Onboarding bewusst idempotent. Pali prüft wiederherstellbare on-chain Accounts, bevor ein neuer Credential/Account-Pfad erstellt wird.

## Smart-Account- und Factory-Struktur

Das Passkey-System hat zwei on-chain Bestandteile:

- **Factory:** erstellt Accounts, berechnet counterfactual Adressen, stellt Wiederherstellungs-Lookups bereit und kann die erste Aktion deployen und ausführen.
- **Smart Account:** speichert Wiederherstellungsmetadaten, Nonce, Sponsor-Policy und validiert WebAuthn/P-256-Ausführungs-Proofs, bevor Calls ausgeführt werden.

Die Factory-Account-Parameter umfassen:

| Parameter | Bedeutung |
| --- | --- |
| `recoveryId` | Wallet-bezogener Wiederherstellungsanker, abgeleitet aus Pali-Wallet-Kontext, Chain id und Factory-Adresse. |
| `passkeyX`, `passkeyY` | P-256-Public-Key-Koordinaten, extrahiert aus dem WebAuthn-Credential. |
| `credentialIdHash` | Hash der WebAuthn-Credential-ID. |
| `rpIdHash` | WebAuthn RP ID-Hash aus Authenticator-Daten. |
| `originHash`, `originLength` | Extension-Origin-Bindungsdaten aus WebAuthn-Client-Daten. |
| `salt` | Deployment-Salt, mit dem ein Credential mehr als einen Smart Account kontrollieren kann. |

Der Smart Account stellt Execution, Signaturvalidierung, Nonce, Sponsor-Policy und Wiederherstellungsmetadaten-Lesevorgänge bereit. Pali verwendet diese Metadaten, um Accounts nach Verlust des lokalen Zustands zu rekonstruieren.

## Mit deaktiviertem Sponsoring erstellen

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## Mit Sponsor-Policy erstellen

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="Pali-Popup zur Erstellung eines Passkey-Accounts mit erforderlichen Sponsor-Policy-Details" />
</a>
  <figcaption>Erforderliches Sponsoring zeigt Sponsor-URL, Signer und Policy-Text, bevor der Benutzer freigibt.</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## Recovery-before-create-Verhalten

Wenn eine dapp einen Passkey-Account anfordert:

1. Pali verifiziert, dass die aktive Chain Passkey Smart Accounts unterstützt.
2. Pali prüft, ob der Passkey einen on-chain Account wiederherstellen kann, der zur angeforderten Sponsor-Policy passt.
3. Wenn der passende Account lokal existiert, verwendet Pali ihn wieder.
4. Wenn der passende Account on-chain existiert, aber nicht lokal, importiert Pali ihn.
5. Wenn ein Account für denselben Sponsor-URL-Hash existiert, aber Modus oder Signer abweicht, lehnt Pali mit einer Wiederherstellungsabweichung ab.
6. Wenn kein passender Account existiert, fährt Pali mit der Erstellung eines neuen Accounts fort.

## Was bestimmt die Adresse?

Die Smart-Account-Adresse wird aus Factory-Inputs abgeleitet, einschließlich Passkey-Public-Koordinaten, Credential-Hash, Origin-Daten, RP ID-Hash, Recovery ID und Deployment-Salt. Sponsor-URL-Text ist selbst nicht der Adress-Seed, aber Sponsor-Policy wird von der Wiederherstellungs-Matching-Logik für institutionsbezogenes Onboarding verwendet.

## Wenn der Benutzer lokale Pali-Daten verliert

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Pali-Einstellungsbildschirm zur Wiederherstellung von Passkey Smart Accounts" />
</a>
  <figcaption>Der Wiederherstellungsbildschirm entdeckt on-chain Passkey-Accounts, die zur wiederhergestellten Wallet und zum Authenticator passen.</figcaption>
</figure>

Wenn Browserprofil, Erweiterungsspeicher oder lokale Passkey-Account-Metadaten verloren gehen, kann die Chain weiterhin genügend öffentliche Metadaten enthalten, um den Account wiederherzustellen:

1. Der Benutzer stellt Pali mit dem Wallet-Kontext wieder her oder öffnet Pali damit, der die Recovery ID verankert.
2. Pali fordert eine discoverable WebAuthn-Assertion vom Authenticator des Benutzers an.
3. Pali fragt die Factory-Registry nach Recovery ID und Credential-Hash ab.
4. Pali liest die Wiederherstellungsmetadaten jedes Kandidaten-Accounts.
5. Pali überspringt Accounts, die bereits lokal vorhanden sind.
6. Pali importiert passende Accounts zurück in den lokalen Wallet-Zustand.

Für dapp-gesteuertes Erstellen/Wiederherstellen vergleicht Pali außerdem Sponsor-Modus, Signer und URL-Hash des wiederhergestellten Accounts mit der von der dapp angeforderten Sponsor-Policy. Dies verhindert, dass eine Institution den Benutzer stillschweigend an eine andere Sponsor-Policy bindet als die, die die dapp angefordert hat.

## RP ID und Credential-Name

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Passkey-Assertion-Prompt des Browsers oder Betriebssystems" />
</a>
  <figcaption>Wiederherstellung und Ausführung erfordern eine WebAuthn-Assertion des relevanten Passkey-Credentials.</figcaption>
</figure>

Der Browser kontrolliert die effektive RP ID für Extension-Origin-WebAuthn, sofern kein RP ID durch den Wallet-Pfad bereitgestellt wird. Pali bezeichnet das standardmäßige gemeinsame Credential als `Pali Wallet Passkey` und verwendet das angeforderte Account-Label für die benutzerseitige Account-Zuordnung.
