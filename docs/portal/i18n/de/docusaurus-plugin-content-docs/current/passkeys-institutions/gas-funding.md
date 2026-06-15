---
title: Gas und Finanzierung
---

Autorisierung und Gas-Zahlung sind getrennt. Ein Validator autorisiert die Aktion; ein finanziertes Wallet-Konto zahlt die Netzwerkgebühr. Der aktuelle Flow nutzt Wallet-paid Gas für Deployment, Modulinstallation, `wallet_sendCalls` und Guardian-Recovery. Dapps sollten keine gaslose UX versprechen, außer eine zukünftige Capability meldet Sponsoring explizit.

## zkSYS-Gas über Paymaster

Auf konfigurierten Netzwerken wie zkTanenbaum kann Pali geeignete Smart-Account-Sends über einen Pali-Paymaster mit zkSYS bezahlen. Beim ersten Mal kann eine einmalige zkSYS-Freigabe erforderlich sein; diese Setup-Transaktion kann weiterhin native Gas benötigen. Wenn zkSYS-Sponsoring optional ist und nicht verfügbar, abgelehnt oder für die Operation unsicher ist, fällt Pali auf native Gas zurück. Dapps sollten dies als zkSYS-paid Smart-Account-Gas beschreiben, nicht als vollständig gasless Flow.
