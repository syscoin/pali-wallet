---
title: Was ist Pali?
---

Pali Wallet ist die offizielle Syscoin Wallet-Erweiterung und eine universelle web3-Wallet für EVM-kompatible Chains. Sie ist für drei sich überschneidende Zielgruppen entwickelt:

- **Normale Benutzer**, die eine sichere Browser-Wallet für EVM, Syscoin, Rollux und UTXO-Assets wünschen.
- **Dapp-Entwickler**, die MetaMask-kompatiblen EVM-Zugriff und UTXO-Zugriff aus derselben Erweiterung möchten.
- **Institutionen**, die Passkey Smart Accounts, Account-Wiederherstellung, Sponsor-Policy und dapp-gesteuertes Onboarding möchten.

## Was Pali anders macht

Die meisten Browser-Wallets stellen nur einen EVM-Provider bereit. Pali stellt zwei komplementäre Oberflächen bereit:

- `window.ethereum` für EVM-dapps, bewusst kompatibel mit gängigen MetaMask-Flows.
- `window.pali` für Syscoin UTXO und Bitcoin-artige Flows.

Dadurch kann eine dapp Erlebnisse entwickeln, die accountbasierte und UTXO-basierte Chains verbinden, ohne Benutzer zur Installation verschiedener Wallets aufzufordern.

## Kompatibilität auf einen Blick

| Fähigkeit | Unterstützte Oberfläche |
| --- | --- |
| EIP-1193-Provider-Requests | `window.ethereum` |
| EIP-6963-Wallet-Discovery | `window.ethereum`-Provider-Ankündigung |
| Account-Berechtigungen | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| EVM-Transaktionen und Signaturen | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, verwandte Signaturmethoden |
| EIP-5792-Batch-Requests | `wallet_sendCalls`, `wallet_getCapabilities` |
| UTXO-Account- und xpub-Zustand | `window.pali` und `sys_*`-Methoden |
| PSBT-Signatur und Broadcast | `sys_sign`, `sys_signAndSend` |
| Erstellung von Passkey Smart Accounts | `wallet_prepareSmartAccount` |

## Aktueller Passkey-Umfang

Passkey Smart Accounts sind nur auf EVM-Netzwerken der zkSYS-Familie verfügbar, auf denen Pali die Passkey-Factory-Contracts konfiguriert hat und die Chain P-256 WebAuthn-Proof-Verifikation unterstützt. Dieser Pali-Build konfiguriert das `zkTanenbaum`-Testnet (`57057`). zkSYS-Produktionsunterstützung nutzt dieselbe Architektur, sobald die Produktions-Factory-Adresse in Pali konfiguriert ist. dapps sollten Capabilities prüfen und nicht unterstützte Chains sauber behandeln.
