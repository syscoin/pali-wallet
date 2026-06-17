---
title: Pali Smart Accounts
---

Pali Smart Accounts sind Contract-Konten, die Pali für Nutzer erstellen, verbinden und bedienen kann. Für normale Nutzer fühlt sich das wie eine Wallet an: Dapp-Anfrage prüfen, mit Passkey oder Wallet-Schlüssel bestätigen, und Pali sendet die Transaktion. Technisch ist das Konto modular: Validatoren autorisieren Aktionen, Executor-Module fügen Funktionen wie Recovery hinzu.

## Einfach erklärt

- Eine Konto-Adresse hält die Assets und ist die Adresse, die Dapps sehen.
- Das Konto kann Passkey, ECDSA oder eine Composite-Policy nutzen.
- Guardian-Recovery kann den aktiven Validator nach einer Wartezeit ersetzen.
- `wallet_sendCalls` kann mehrere Calls als eine atomare Aktion ausführen.

## Technisches Modell

`PaliSmartAccount` führt Calls aus und validiert Signaturen über ERC-7579-style Module. `PaliSmartAccountFactory` leitet deterministische Adressen ab und deployed Konten. Pali nutzt ERC-4337-style Encoding und EIP-1271 für Contract-Signaturen.

## Zwei Rollen: Validatoren signieren, Guardians stellen wieder her

ERC-7579 trennt Modulrollen, und Pali setzt bewusst auf diese Trennung:

- **Validatoren** sind die Signaturautorität. Ein Validator entscheidet, ob eine bestimmte Freigabe (Passkey-Nachweis, ECDSA-Signatur, Ergebnis einer Composite-Policy) eine Kontoaktion autorisiert. Nur Validatoren können Transaktionen freigeben.
- **Executors** fügen Kontoverhalten hinzu, das keine Signatur ist. Palis Guardian-Recovery-Modul ist ein Executor: Guardians können nicht signieren und keine Gelder bewegen, sie können nur einen zeitverzögerten Ersatz des aktiven Validators planen.

Diese Rollentrennung macht Recovery sicher genug, um sie zu empfehlen. Die Kompromittierung eines Guardians gibt einem Angreifer keine Signaturmacht — sie gibt ihm einen verzögerten, sichtbaren und abbrechbaren Recovery-Versuch.

## Composite-Signatur-Policies

Der Composite-Validator kombiniert Kind-Validatoren unter einem Threshold und macht ein Konto damit zu einer Policy-Engine:

- **1-of-N** — jeder von mehreren Authenticators kann freigeben. Praktisch für persönliche Konten mit einem Passkey auf jedem Gerät.
- **t-of-N** — ein Quorum muss freigeben. Die natürliche Form für gemeinsame Treasuries, Trading-Desks und teamkontrollierte Konten.
- **N-of-N** — jeder konfigurierte Validator muss freigeben. Konten mit maximaler Absicherung.

Composites können verschachtelt werden: Ein Kind eines Composite kann selbst ein Composite sein, sodass hierarchische Policies — zum Beispiel „der CFO-Schlüssel UND (beliebige 2 von 3 Desk-Passkeys)“ — ohne eigene Contracts ausdrückbar sind. Guardian-Recovery bleibt unabhängig davon, welche Validator-Policy aktiv ist.

## Validator-Agilität und Post-Quanten-Bereitschaft

Weil die Autorisierung in austauschbaren Modulen liegt, ist das Konto an kein Signaturverfahren gebunden. Heute liefert Pali ECDSA (den wallet-eigenen Standard), P-256 WebAuthn-Passkeys und den Composite-Validator. Wenn neue Validator-Typen deployed werden — einschließlich Post-Quanten-Signaturverfahren — werden sie auf demselben Konto an derselben Adresse installiert. Ab diesem Punkt kann die Autorisierung pro Transaktion ganz ohne ECDSA laufen. Gelder, Verlauf und Integrationen ziehen nie um; nur die Signaturautorität entwickelt sich weiter.

Dieselbe Agilität gilt für die Wiederherstellung. Das Guardian-Recovery-Modul prüft Freigaben über Standard-Signaturprüfung — einfaches ECDSA für normale Adressen, ERC-1271 für Contract-Konten — sodass ein Guardian selbst ein Smart Account sein kann, der von einem Composite-, Custom- oder Post-Quanten-Validator kontrolliert wird. Ein deployter Contract-Account-Guardian lässt den Recovery-Pfad das Signaturverfahren dieses Kontos erben — so können sowohl Signieren **als auch** Recovery irgendwann ohne klassische ECDSA-Abhängigkeit laufen. Palis aktuelle Guardian-UX sammelt schlüsselbasierte Freigaben; Flows für Contract-Account-Guardians können später in der Wallet ergänzt werden, weil das On-Chain-Modul sie bereits unterstützt.

## Für Institutionen und Teams

Institutionen sollten Pali Smart Accounts als Kontoinfrastruktur behandeln, nicht nur als Passkey-Login. Nutzt Passkeys für einfaches Onboarding, ECDSA oder Composite-Validatoren für Team- oder Hardware-Wallet-Kontrolle, Guardian-Recovery für verzögerten Ersatz und finanzierte Gas-Payer für Deployment und Ausführung.

Pali warnt ausdrücklich, wenn eine Dapp externe ECDSA-Owner anfordert, weil diese Adressen zukünftige Kontoaktionen autorisieren können.

## Dapp-Methode

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

## Unterstützte Netzwerke

Pali Smart Accounts funktionieren auf kompatiblen EVM-Chains, auf denen die Pali Factory und Module an den von Pali erwarteten Adressen existieren. Das ist nicht auf von Pali betriebene Chains beschränkt: Wenn die aktive Chain den kanonischen CREATE2-Deployer bereitstellt, kann Pali die fehlende Smart-Account-Einrichtung direkt in der Wallet deployen. Öffnen Sie Pali Settings, gehen Sie zu Advanced und nutzen Sie bei **Smart account setup** den Deploy-Button.

Passkey-Validatoren benötigen P-256 WebAuthn-Verifikation. Viele moderne EVM-Umgebungen stellen dies über ein P-256/passkey precompile bereit; prüft die Chain-Unterstützung trotzdem vor dem produktiven Einsatz.

## Benutzerkontrolle

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>Nach der Wallet-Prüfung übernimmt der Browser oder das Betriebssystem die WebAuthn-Passkey-Erstellung, wenn der gewählte Validator passkey-basiert ist.</figcaption>
</figure>

Der Nutzer sieht vor der Freigabe die anfragende Website, das Konto-Label, den angeforderten Authenticator und etwaige externe ECDSA-Owner-Adressen. Der Browser oder das Betriebssystem zeigt den WebAuthn-Prompt, wenn Pali eine neue Passkey-Credential benötigt. Pali zeigt Deployment, Modulinstallation und Bestätigungsfortschritt an, bevor der Smart Account mit der Dapp verbunden wird.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-dapp-onboarding-video.png" src="/video/smart-account-dapp-onboarding.mp4" title="Smart-account dapp onboarding flow"></video>
  <figcaption>Dapp-initiiertes Onboarding: Anfrage prüfen, bestätigen, und der Smart Account ist einsatzbereit.</figcaption>
</figure>

## Standard-Referenzen

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
