---
title: Passkey-Accounts
---

Passkey-Accounts sind EVM Smart Accounts, die durch WebAuthn-Credentials kontrolliert werden. Statt mit einem normalen privaten EOA-Schlüssel zu signieren, bestätigt der Benutzer Aktionen mit der Geräte- oder Account-Passkey-UI, die vom Browser und Betriebssystem bereitgestellt wird.

Im Hintergrund verwenden WebAuthn-Passkeys P-256-Signaturen. zkSYS-Passkey-Accounts sind so gebaut, dass diese P-256-Proofs durch das Smart-Account/Factory-System verifiziert werden können. Deshalb kann eine biometrische oder Plattform-Passkey-Freigabe eine on-chain Aktion autorisieren.

## Warum einen Passkey-Account verwenden?

- Einfacheres institutionelles Onboarding.
- Unterstützung für Smart-Account-Policies.
- Optionale Sponsor-Services für Gas oder Co-Autorisierung.
- Batch-Ausführung mit einer einzigen Benutzerfreigabe.
- Wiederherstellung aus on-chain Registry-Daten, wenn lokale Wallet-Metadaten fehlen.

## Gemeinsame und getrennte Passkeys

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="Pali-Einstellungsbildschirm zum Erstellen eines Passkey-Accounts" />
</a>
  <figcaption>Benutzer können Passkey-Accounts sowohl aus den Einstellungen als auch aus dapp-Requests erstellen.</figcaption>
</figure>

Pali kann ein gemeinsames Wallet-Passkey-Profil verwenden oder ein separates Passkey-Credential für einen Account erstellen. Gemeinsame Passkeys sind praktisch für Benutzer, die einen einzigen durch die Wallet kontrollierten Passkey möchten. Getrennte Passkeys können Institutionen helfen, Credentials pro Service oder Policy zu isolieren.

## Deployment

Ein Passkey Smart Account kann als counterfactual Adresse existieren, bevor er on-chain deployed ist. Die erste Ausführung kann den Account deployen und die angeforderte Aktion in einem Flow ausführen, wenn Netzwerk und Funding-Pfad dies unterstützen.

Wenn der Account noch nicht deployed ist, stellen Sie sicher, dass der Passkey-Account oder der Deployment-Gas-Zahler genügend nativen Token hat, oder verwenden Sie einen institutionellen Sponsor-Pfad, der den Deployment-Flow unterstützt.

## Netzwerkunterstützung

Passkey-Accounts erfordern zkSYS-Passkey-Smart-Account-Contracts und P-256-Verifikationsunterstützung. In diesem Pali-Build ist das `zkTanenbaum`-Testnet für die Erstellung von Passkey-Accounts konfiguriert. zkSYS-Produktionsunterstützung nutzt dasselbe Modell, sobald die Produktions-Factory-Adresse in der Wallet konfiguriert ist.

## Wiederherstellung

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Pali-Einstellungsbildschirm für Passkey-Account-Policies" />
</a>
  <figcaption>Der Passkey-Policy-Bildschirm zeigt Sponsor-Modus, Signer, URL und, sofern verfügbar, Backup-Status.</figcaption>
</figure>

Wenn lokaler Wallet-Zustand gelöscht wird oder Pali auf einem neuen Gerät installiert ist, kann Pali Passkey Smart Accounts aus der on-chain Factory-Registry und Event-Logs wiederherstellen. Jede Pali-Installation mit Zugriff auf dasselbe Passkey-Credential kann die passenden deployten Accounts nach einer WebAuthn-Assertion entdecken, lokal bereits vorhandene Accounts überspringen und die ausgewählten Accounts importieren.
