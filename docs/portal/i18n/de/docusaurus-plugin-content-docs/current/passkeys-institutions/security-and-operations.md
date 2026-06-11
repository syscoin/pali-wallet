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

Ein Composite-Validator kann Kind-Validatoren unter einem Threshold kombinieren — 1-of-N, t-of-N oder N-of-N — und Kinder können selbst Composites sein, sodass hierarchische Policies möglich sind.

Dokumentiere beim Entwurf einer Composite-Policy die Begründung für den Threshold: 1-of-N optimiert Verfügbarkeit, N-of-N optimiert Absicherung, und t-of-N balanciert beides. Validatoren sind austauschbare Module, daher kann die Policy (und sogar das Signaturverfahren — einschließlich zukünftiger Post-Quanten-Validatoren) später aktualisiert werden, ohne die Konto-Adresse zu ändern. Guardians sind ein Modul in der Executor-Rolle und bleiben unabhängig davon, welche Validator-Policy aktiv ist.

Guardian-Recovery ist ein verzögerter Validator-Ersatz. Pali nutzt pro Versuch ein frisches Salt, und das Modul erlaubt nur eine aktive Recovery pro Konto.
