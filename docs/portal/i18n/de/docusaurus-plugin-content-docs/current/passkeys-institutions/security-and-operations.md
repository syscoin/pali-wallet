---
title: Sicherheit und Betrieb
---

Institutionelle Passkey-Integrationen sollten wie produktive Account-Infrastruktur entworfen werden, nicht nur wie eine Login-Schaltfläche.

## Netzwerk- und Verifier-Abhängigkeit

Passkey-Accounts hängen von zkSYS-Unterstützung zur Verifikation von P-256-WebAuthn-Signaturen ab. Nehmen Sie nicht an, dass ein Passkey-Account auf jeder EVM-Chain erstellt werden kann, nur weil die Chain Smart Contracts unterstützt. Die Chain muss die Passkey-Factory deployed haben, und Pali muss diese Factory-Adresse für die aktive Chain konfiguriert haben.

Heute ist Palis konfigurierte Testbereitstellung `zkTanenbaum` (`57057`). Behandeln Sie zkSYS-Produktion als Produktions-Deployment-Ziel für dieselbe Architektur, sobald dessen Factory in der Wallet konfiguriert ist.

## Operative Checkliste

- Entscheiden Sie, ob jeder Benutzer einen gemeinsamen Pali-Passkey-Account oder ein separates Credential erhält.
- Entscheiden Sie, ob Sponsoring deaktiviert, gas-only oder erforderlich ist.
- Halten Sie Sponsor-Service-Uptime aufrecht, wenn der Modus `required` von einer entfernten Sponsor-URL abhängt, und dokumentieren Sie jede lokale Signer-Fallback-Policy.
- Überwachen Sie Relayer-Fehler, abgelaufene Deadlines und wiederholte Idempotency Keys.
- Stellen Sie einen Benutzersupport-Pfad für verlorene Geräte und fehlgeschlagene Wiederherstellung bereit.
- Dokumentieren Sie, ob die Institution Ausführung co-autorisieren kann.

## Funding und Deployment

Passkey Smart Accounts können vor der ersten Nutzung counterfactual sein. Die erste Ausführung kann einen Deployment-Gas-Zahler oder Sponsor-Pfad benötigen. Ihr Onboarding-Flow sollte erklären, ob Benutzer den Account vor der Nutzung fundieren müssen.

Die Factory kann die Account-Adresse vor dem Deployment berechnen. Das ist für Onboarding nützlich, weil eine dapp oder Institution die Adresse vor der ersten on-chain Transaktion anzeigen oder fundieren kann.

## Wiederherstellungsannahmen

Wiederherstellung ist wallet-bezogen und passkey-bezogen. Ein Benutzer benötigt allgemein:

- den wiederhergestellten Pali-Wallet-Kontext
- das relevante WebAuthn-Credential
- Chain-Unterstützung für die Passkey-Factory
- Sponsor-URL-Metadaten, wenn der wiederhergestellte Account erforderliches Sponsoring verwendet und Pali die URL nicht ableiten kann

Wiederherstellung ist keine custodial Hintertür. Die Chain stellt auffindbare öffentliche Metadaten und Account-Listen bereit, aber der Benutzer benötigt weiterhin den Wallet-Wiederherstellungskontext und das relevante WebAuthn-Credential, um Kontrolle nachzuweisen.

## Credential-Backup-Status

Pali kann WebAuthn-Credential-Backup-Status anzeigen, wenn Browser und Authenticator ihn offenlegen. Behandeln Sie dies als operatives Signal, nicht als on-chain Sicherheitsregel.

Backup-Status kann anzeigen, ob ein Credential gerätegebunden, backupfähig oder aktuell durch den Plattform-Passkey-Anbieter gesichert/synchronisiert erscheint. Ein synchronisierter Passkey kann Komfort und Wiederherstellung nach Geräteverlust verbessern, weil der Benutzer das Credential möglicherweise über seinen Apple-, Google-, Microsoft- oder anderen Plattform-Account wiederherstellen kann. Die Abwägung ist, dass die effektive Sicherheitsgrenze nun diesen Plattform-Account, dessen Wiederherstellungsprozess und alle Geräte umfasst, auf denen der Passkey synchronisiert ist.

| Credential-Status | Auswirkung auf Institutions-Policy | Benutzererfahrung | Risikogrenze |
| --- | --- | --- | --- |
| Gesichert oder synchronisiert | Akzeptieren, wenn Account-Wiederherstellung und Onboarding-Komfort wichtiger sind als strikte Geräteisolation. | Beste Geräteersatz- und Multi-Geräte-Erfahrung. Häufig der Plattformstandard für Verbraucher-Passkeys. | Vertrauen erstreckt sich auf den Plattform-Account, den Plattform-Wiederherstellungsflow und synchronisierte Geräte. |
| Backupfähig | Entscheiden Sie, ob Fähigkeit allein akzeptabel ist, weil das Credential später synchronisiert werden kann. | Flexibel, aber Benutzer verstehen möglicherweise nicht, ob Synchronisierung aktiv ist. | Erfordert klare Benutzerhinweise und regelmäßige Statusprüfung, wenn sich der Account-Wert ändert. |
| Gerätegebunden oder nicht gesichert | Bevorzugt für hochwertige, Treasury-, Admin- oder cold-artige Accounts. | Mehr Reibung und höhere Supportlast, wenn das Gerät verloren geht. | Stärkere Isolation auf einen bestimmten Authenticator oder Hardware-Schlüssel. |
| Unbekannt oder nicht verfügbar | Für Policy-Entscheidungen mit hohen Assurance-Anforderungen vermeiden, sofern Sie keine out-of-band Authenticator-Kontrollen haben. | Benutzer kann fortfahren, aber die Institution kann das Credential nicht zuverlässig klassifizieren. | Mehrdeutig; nicht als Beweis für Cloud-Backup oder als Beweis für gerätegebundene Isolation behandeln. |

Für institutionelle Accounts mit höheren Assurance-Anforderungen sollten Sie entscheiden und dokumentieren, ob synchronisierte Passkeys akzeptabel sind. Synchronisierte Passkeys sind für gängige Wallet- und dapp-Nutzung weiterhin sicher, weil Pali und die dapp den privaten Passkey-Schlüssel nie erhalten, WebAuthn origin-gebunden bleibt und der Plattform-Authenticator weiterhin Benutzerverifikation durchführt. Sie sind einfach nicht die richtige Voreinstellung für Cold Storage, Treasury-Kontrollen oder große langfristige Guthaben, sofern die Institution die Plattform-Account-Wiederherstellungsgrenze nicht ausdrücklich akzeptiert.

## Benutzerkommunikation

Verwenden Sie klaren Policy-Text. Eine gute Policy erklärt:

- wer den Sponsor-Service betreibt
- welche Aktionen Co-Autorisierung erfordern
- ob die Institution Gas zahlt
- was passiert, wenn der Sponsor-Service nicht verfügbar ist

## Nicht auf Policy-Text für Enforcement verlassen

`policyText` ist ein Offenlegungs- und Wallet-Metadatenfeld. Enforcement erfolgt über on-chain Policy und Sponsor-Proof-Validierung.
