---
title: Smart Accounts und Passkeys
---

Pali Smart Accounts sind EVM-Contract-Konten, die durch Module kontrolliert werden. Ein Passkey ist eine unterstützte Kontrollform; ECDSA und Composite-Policies sind ebenfalls möglich.

Validatoren beantworten die Frage „Wer darf Aktionen für dieses Konto freigeben?“ — und das Nützliche daran ist, dass sich die Antwort ändern kann, ohne dass sich Ihr Konto ändert:

- **Eine beliebige meiner Anmeldungen** (1-of-N): Freigabe mit dem Passkey oder Schlüssel, der gerade zur Hand ist.
- **Einige von uns gemeinsam** (t-of-N): Ein Quorum von Personen oder Geräten muss zustimmen — ideal für gemeinsame Gelder.
- **Alle von uns gemeinsam** (N-of-N): Jede konfigurierte Anmeldung muss freigeben, für die sensibelsten Konten.

Policies können sogar andere Policies enthalten, sodass ein Team Dinge ausdrücken kann wie „der Schlüssel der Teamleitung plus zwei beliebige Desk-Passkeys“. Ihre Adresse, Salden und Ihr Verlauf bleiben exakt gleich, wenn sich die Policy ändert — und weil das Signieren modular ist, können später neue Signaturtypen (einschließlich Post-Quanten-Verfahren) auf demselben Konto übernommen werden.

Guardians stehen bewusst **nicht** auf dieser Liste. Ein Guardian kann niemals eine Transaktion freigeben; seine einzige Befugnis ist es, eine langsame, sichtbare Wiederherstellung zu starten, falls Sie den Zugriff verlieren. Diese Trennung schützt vor verlorenem Zugriff, ohne irgendjemandem die alltägliche Kontrolle zu geben.

Pali Smart Accounts sind nützlich für Passkey-Freigaben, Team-Owner, Batch-Aktionen und Guardian-Recovery. Pali deployed deterministisch über die Factory und speichert dauerhafte Metadaten. Guardian-Recovery ist nicht sofort: Ein Guardian signiert eine Absicht, das Modul plant sie mit Delay, und danach kann der Validator ersetzt werden.
