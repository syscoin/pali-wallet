---
title: Gas und Finanzierung
---

Autorisierung und Gas-Zahlung sind getrennt. Ein Validator autorisiert die Aktion; ein finanziertes Wallet-Konto zahlt die Netzwerkgebühr. Der aktuelle Flow nutzt Wallet-paid Gas für Deployment, Modulinstallation, `wallet_sendCalls` und Guardian-Recovery. Dapps sollten keine gaslose UX versprechen, außer eine zukünftige Capability meldet Sponsoring explizit.
