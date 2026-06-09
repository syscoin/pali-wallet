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

Guardian-Recovery ist ein verzögerter Validator-Ersatz. Pali nutzt pro Versuch ein frisches Salt, und das Modul erlaubt nur eine aktive Recovery pro Konto.
