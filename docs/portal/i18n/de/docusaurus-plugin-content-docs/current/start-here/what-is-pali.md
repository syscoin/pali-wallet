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

## Was ist neu in Pali v4

Pali v4 ist eine grundlegende Modernisierung der Wallet rund um drei Ideen: Geschwindigkeit, Standards und flexible Signaturautorität.

- **Überall schneller.** Pali bündelt RPC-Traffic auf EVM- und UTXO-Netzwerken, sodass Salden, Verlauf und Gebührendaten in deutlich weniger Roundtrips geladen werden. Das Ergebnis ist eine Wallet, die sich sofort statt beschäftigt anfühlt.
- **Standardbasierte Smart Accounts.** Pali Smart Accounts folgen dem ERC-7579-Modulmodell mit ERC-4337-artiger Ausführungskodierung. Nichts am Konto ist proprietärer Lock-in: Validatoren, Executors und das Kontoverhalten folgen öffentlichen Spezifikationen.
- **Autorisierung ist vom Konto getrennt.** Wer signieren darf, ist eine Modul-Entscheidung, keine in die Adresse eingebrannte Eigenschaft. Heute bedeutet das wallet-eigene ECDSA-Schlüssel und P-256 WebAuthn-Passkeys. Morgen können das neue Validator-Typen sein — einschließlich Post-Quanten-Signaturverfahren — die auf demselben Konto an derselben Adresse installiert werden, ganz ohne ECDSA in der Autorisierung einzelner Transaktionen.
- **Kombinierbare Signatur-Policies.** Ein Composite-Validator kombiniert Kind-Validatoren unter einem Threshold: 1-of-N für Komfort, t-of-N für geteilte Kontrolle, N-of-N für maximale Absicherung. Composites können verschachtelt werden, sodass Policies hierarchisch sein können.
- **Guardians schützen vor verlorenem Zugriff.** Guardian-Recovery ist ein separates Modul in der Executor-Rolle (gemäß ERC-7579), bewusst getrennt von Validatoren. Guardians können keine Transaktionen signieren; sie können nur einen zeitverzögerten Validator-Ersatz planen. Guardians lassen sich jederzeit hinzufügen oder entfernen, solange das Konto gesund ist.

## Wohin sich Pali entwickelt

Palis Richtung ist **dynamische und flexible Signaturautorität für Krypto-Frontends**. Jedes Frontend — eine dapp, eine Börse, ein institutionelles Dashboard, ein eingebetteter Dienst — soll die Wallet nach genau der Signatur-Policy fragen können, die die Aufgabe erfordert: ein Passkey für müheloses Onboarding, ein t-of-N-Composite für eine gemeinsame Treasury, ein hardware-gestützter Guardian für die Wiederherstellung oder ein zukünftiger Validator-Typ, den es heute noch nicht gibt. Die Konto-Adresse bleibt stabil, während sich die Autorität dahinter weiterentwickelt.

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
