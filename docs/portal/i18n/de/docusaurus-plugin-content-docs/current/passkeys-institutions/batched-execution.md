---
title: Batch-Ausführung
---

Pali Smart Accounts unterstützen Batch-Ausführung über `wallet_sendCalls`. Nutzer prüfen mehrere Calls und autorisieren sie als eine Kontoaktion. Wenn `atomicRequired` true ist, bereitet Pali die ausgewählten Calls als eine Smart-Account-Ausführung vor. Contract-Deployment-Calls mit leerem Target werden in diesem Flow nicht unterstützt.
