---
title: Sicherheit und Betrieb
---

Pali Smart Accounts sind Kontoinfrastruktur. Der Contract hält Assets, und installierte Module entscheiden, wer sie bewegen kann.

## Checkliste

- Entscheide, welcher Validator das Konto kontrolliert: Passkey, ECDSA, Composite oder Recovery.
- Behandle externe ECDSA-Owner als hohes Risiko.
- Definiere Guardians, Threshold und Recovery-Delay.
- Halte den Gas-Payer finanziert.
- Überwache fehlgeschlagene Deployments, Modulinstallationen und abgelaufene Recoveries.

Pali sammelt derzeit lokal verfügbare Freigaben eingebauter Kind-Validatoren bis zum Threshold. Verschachtelte Composites und das Sammeln externer oder geräteübergreifender Freigaben werden von dieser Wallet-Version nicht unterstützt. Guardian-Recovery bleibt von der aktiven Validator-Policy unabhängig.

Dokumentiere beim Entwurf einer Composite-Policy die Begründung für den Threshold: 1-of-N optimiert Verfügbarkeit, N-of-N optimiert Absicherung, und t-of-N balanciert beides. Validatoren sind austauschbare Module, daher kann die Policy (und sogar das Signaturverfahren — einschließlich zukünftiger Post-Quanten-Validatoren) später aktualisiert werden, ohne die Konto-Adresse zu ändern. Guardians sind ein Modul in der Executor-Rolle und bleiben unabhängig davon, welche Validator-Policy aktiv ist.

Palis geführte Guardian-Recovery ersetzt den aktiven Validator nach einer Wartezeit. Die bisherige Freigabemethode bleibt bis zum bestätigten Abschluss aktiv. Der On-Chain-Executor kann jedoch von Guardians genehmigte Kontoaktionen ausführen und ist nicht auf die Validator-Ersetzung der Benutzeroberfläche beschränkt; installierte Hooks können weitere Grenzen setzen. Ein kompromittierter Guardian-Threshold gefährdet Kontrolle und Guthaben. Das installierte Modul verlangt gültige Guardian-Freigaben; Pali verwendet einen neuen Salt je Versuch, und der Vertrag erlaubt nur einen nicht abgelaufenen aktiven Vorgang pro Konto.

:::tip Aktuelle Anleitung zu Guardian-Recovery

Die [vollständige Anleitung](../users/smart-account-validators#guardian-recovery-guide) beschreibt Einrichtung, Start, Abschluss und **Disable guardian recovery**. Neue Richtlinien bieten 3 oder 7 Tage Wartezeit; 10 Minuten sind nur für bekannte Testnetze vorgesehen. Bestätigtes Deaktivieren erfordert die aktuelle Freigabemethode und Gas, verwirft ausstehende Wiederherstellungen und entfernt diesen Wiederherstellungsweg, macht aber keine abgeschlossene Wiederherstellung rückgängig. Bei unklarem Transaktionsstatus zuerst On-Chain prüfen. Optionale Sysnode-E-Mail-Hinweise erfordern eine verifizierte E-Mail-Adresse und eine Wallet-Signatur; sie erhalten keine Schlüssel und sind keine Zustellgarantie.

:::
