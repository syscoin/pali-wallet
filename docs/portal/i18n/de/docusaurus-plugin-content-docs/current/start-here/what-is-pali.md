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

Pali Smart Accounts sind auf EVM-Netzwerken verfügbar, auf denen die Pali Factory und Module an den von Pali genutzten Adressen existieren. Dieser Pali-Build konfiguriert das `zkTanenbaum`-Testnet (`57057`), und zkSYS-Produktionsunterstützung nutzt dieselbe Architektur, sobald die Produktionsadressen konfiguriert sind.

Die Infrastruktur ist nicht auf von Pali betriebene Chains beschränkt. Auf kompatiblen EVM-Netzwerken mit kanonischem CREATE2-Support kann Pali die erforderliche Smart-Account-Einrichtung direkt in der Wallet deployen: Pali Settings öffnen, Advanced wählen und bei **Smart account setup** den Deploy-Button nutzen. Passkey-Validatoren benötigen P-256 WebAuthn-Verifikation, die viele moderne EVM-Umgebungen über ein P-256/passkey precompile bereitstellen.
