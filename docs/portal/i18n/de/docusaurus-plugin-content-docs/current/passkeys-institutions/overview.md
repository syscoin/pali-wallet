---
title: Passkeys und Institutionen
---

Pali Passkey Smart Accounts ermöglichen einer dapp, Account-Erstellung oder -Wiederherstellung von der Wallet anzufordern, während der Benutzer die Ausführung über WebAuthn kontrolliert.

Dies ist nützlich für:

- institutionelles Onboarding
- sponsorgestützte Gas-Flows
- co-autorisierte Policies
- Account-Wiederherstellung nach Wallet-Neuinstallation
- atomare Multi-Call-Workflows
- dapps, die Passkey-UX möchten, ohne eine Wallet zu bauen

## Warum zkSYS-Passkeys möglich sind

Passkeys verwenden WebAuthn, und WebAuthns Standard-Signaturalgorithmus ist ES256: ECDSA über der P-256-Kurve, auch bekannt als secp256r1. Generische EVM-Wallets verwenden normalerweise secp256k1-EOAs, daher ist eine Passkey-Signatur nicht direkt eine EOA-Signatur.

Palis Passkey-Accounts sind zkSYS Smart Accounts, die um on-chain P-256-Verifikation herum entworfen sind. Die Wallet extrahiert die WebAuthn-Public-Key-Koordinaten, Challenge, Authenticator-Daten, Client-Daten und P-256-Signatur; anschließend verifiziert der Smart-Account/Factory-Pfad diesen Proof gegen die registrierten Metadaten des Accounts. Dadurch werden Gerätebiometrie oder Plattform-Passkeys für Account-Autorisierung nutzbar, während der private Schlüssel im Authenticator des Benutzers bleibt.

Das praktische Ergebnis ist eine Wallet-UX, die sich wie biometrischer Login anfühlt, aber eine Chain-Aktion autorisiert:

1. Die dapp fordert einen Passkey Smart Account oder Batch-Ausführung an.
2. Pali bereitet einen Action-Hash für die genaue Chain, den Account, die Calls, Nonce, Deadline und Sponsor-Policy vor.
3. Der Browser/das OS fragt den Benutzer nach Passkey-Freigabe.
4. Der zkSYS Smart Account verifiziert den P-256-WebAuthn-Proof on-chain vor der Ausführung.

## Unterstützte Netzwerke

Passkey-Accounts sind nicht auf jeder EVM-Chain aktiviert. Sie erfordern eine konfigurierte Passkey-Factory und zkSYS-P-256-Verifikationsunterstützung.

| Netzwerk | Chain id | Status in diesem Pali-Build |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Konfiguriert. Factory: `0x2753d01E741D1E9E54956203766f5F501819cad3`. |
| `zkSYS` | TBD in wallet config | Vorgesehenes Produktionsziel für dieselbe Passkey-Architektur, sobald die Factory-Adresse in Pali konfiguriert ist. |

Wenn eine dapp `wallet_createPasskeyAccount` auf einem Netzwerk ohne konfigurierte Factory aufruft, lehnt Pali den Request ab, statt nicht unterstützte Metadaten zu erstellen.

## dapp-Methode

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="Pali wallet_createPasskeyAccount-Popup mit deaktiviertem Sponsoring" />
</a>
  <figcaption>Der standardmäßige dapp-gesteuerte Passkey-Flow sollte mit deaktiviertem Sponsoring starten, sofern die Institution nicht ausdrücklich Sponsor-Policy benötigt.</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

Das Ergebnis enthält die Smart-Account-`address` und öffentliche Passkey-Metadaten.

## Sponsor-Modi

| Modus | Bedeutung |
| --- | --- |
| `disabled` | Keine Sponsor-Policy. Die Wallet/der Benutzer zahlt Gas. |
| `gasOnly` | Sponsor-Service kann Gas zahlen. Pali benötigt für diesen Modus eine Sponsor-URL; wenn Sponsoring fehlschlägt, kann Wallet-Gas-Fallback erlaubt sein. |
| `required` | Sponsor-Co-Autorisierung ist durch Policy erforderlich. Ein Signer ist erforderlich; die Sponsor-URL ist optional, wenn Pali den Signer-Proof von einem lokalen Konto in der Wallet erhalten kann. |

## Benutzerkontrolle

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Passkey-Erstellungsdialog des Browsers oder Betriebssystems" />
</a>
  <figcaption>Nach der Wallet-Prüfung übernimmt der Browser oder das Betriebssystem die WebAuthn-Passkey-Erstellung.</figcaption>
</figure>

Der Benutzer sieht die anfragende Site, Label, Sponsor-Modus, Signer, URL und Policy-Text vor der Freigabe. Der Browser oder das OS zeigt anschließend den WebAuthn-Passkey-Prompt.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey-dapp-Onboarding-Flow"></video>
  <figcaption>Passkey-Onboarding-Flow: gebrandetes Intro, dapp-Request und Pali-Account-Freigabe.</figcaption>
</figure>
