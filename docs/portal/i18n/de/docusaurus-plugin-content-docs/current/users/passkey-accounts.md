---
title: Smart Accounts und Passkeys
---

Pali Smart Accounts sind EVM-Contract-Konten, die durch Module kontrolliert werden. Ein Passkey ist eine unterstützte Kontrollform; ECDSA und Composite-Policies sind ebenfalls möglich.

Sie sind nützlich für Passkey-Freigaben, Team-Owner, Batch-Aktionen und Guardian-Recovery. Pali deployed deterministisch über die Factory und speichert dauerhafte Metadaten. Guardian-Recovery ist nicht sofort: Ein Guardian signiert eine Absicht, das Modul plant sie mit Delay, und danach kann der Validator ersetzt werden.
