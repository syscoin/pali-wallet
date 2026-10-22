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

- **Validatoren** prüfen Signaturen für normale Kontofreigaben, etwa Passkeys, ECDSA und Composite-Policies.
- **Executors** können Kontoaktionen über ein installiertes Modul ausführen. Palis Guardian-Modul verlangt den konfigurierten Threshold und eine Wartezeit. Der geführte Wallet-Ablauf ersetzt den aktiven Validator; das On-Chain-Modul ist nicht auf diese UI-Aktion beschränkt.

Guardians besitzen somit verzögerte Kontoberechtigungen. Ein kompromittierter Threshold gefährdet Kontrolle und Guthaben. Der aktuelle Eigentümer kann während der Wartezeit reagieren, muss seine Schutzmaßnahme aber vor einer bösartigen Ausführung bestätigen lassen. Siehe [Guardian-Recovery](../users/smart-account-validators).

## Composite-Signatur-Policies

Der Composite-Validator kombiniert Kind-Validatoren unter einem Threshold und macht ein Konto damit zu einer Policy-Engine:

- **1-of-N** — jeder von mehreren Authenticators kann freigeben. Praktisch für persönliche Konten mit einem Passkey auf jedem Gerät.
- **t-of-N** — ein Quorum muss freigeben. Die natürliche Form für gemeinsame Treasuries, Trading-Desks und teamkontrollierte Konten.
- **N-of-N** — jeder konfigurierte Validator muss freigeben. Konten mit maximaler Absicherung.

Pali sammelt derzeit lokal verfügbare Freigaben eingebauter Kind-Validatoren bis zum Threshold. Verschachtelte Composites und das Sammeln externer oder geräteübergreifender Freigaben werden von dieser Wallet-Version nicht unterstützt. Guardian-Recovery bleibt von der aktiven Validator-Policy unabhängig.

## Validator-Agilität und Post-Quanten-Bereitschaft

Auf entsprechend konfigurierten Netzwerken unterstützt Pali wallet-eigenes ECDSA, P-256-WebAuthn-Passkeys, SLH-DSA und Composite-Validatoren. Die jeweiligen On-Chain-Module müssen bereitgestellt und die benötigten lokalen Schlüssel oder Zugangsdaten verfügbar sein. Austauschbare Module ermöglichen auch spätere Signaturverfahren auf derselben Konto-Adresse. Ein Validatorwechsel verschiebt weder Gelder noch Verlauf oder Integrationen.

Das Guardian-Modul prüft ECDSA-Freigaben normaler Adressen und ERC-1271-Freigaben von Vertragskonten. Pali kann lokale schlüsselbasierte Guardians sowie bereits bereitgestellte lokale Smart-Account-Guardians verwenden, für die es signieren kann, einschließlich SLH-DSA. Ein externer, lokal nicht signierbarer Guardian benötigt einen externen Freigabeablauf.

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
