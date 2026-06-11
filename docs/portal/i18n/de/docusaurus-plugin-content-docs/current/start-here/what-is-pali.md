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

## Was ist anders an Pali?

Pali ist um eine Idee herum gebaut: Die Wallet sollte die Sicherheitsgrenze des Benutzers sein, nicht ein Server. Pali kann wie jede Browser-Wallet von RPC-Nodes, Explorern und Indexern lesen, aber Verwahrung, Freigaben, Wiederherstellung und Account-Policy bleiben bei den Schlüsseln des Benutzers und bei On-Chain-Modulen.

- **Kein Verwahrungs- oder Wiederherstellungsserver.** Pali speichert keinen serverseitigen Schlüssel, keine cloudbasierten verschlüsselten Daten, keine Policy-Engine und keine Recovery-Backdoor. Sensible Aktionen werden in der Erweiterung freigegeben, von der Wallet, dem Passkey, dem Hardware-Gerät oder dem Smart-Account-Validator des Benutzers signiert und von der Chain erzwungen.
- **Schnelle Lesezugriffe mit robusten Fallbacks.** Wenn Pali viele EVM-Contract-Reads benötigt, versucht es zuerst Multicall3 `aggregate3`: ein On-Chain-`eth_call`, eine Same-Block-Ansicht und isolierte Fehler pro Call. Wenn Multicall3 nicht deployed ist oder der RPC den Call ablehnt, fällt Pali auf JSON-RPC-Batching zurück; wenn Batching nicht verfügbar ist, fällt es erneut auf einzelne Calls zurück. So bleibt die UI auf modernen Chains schnell, ohne auf einfachen RPC-Providern zu brechen.
- **Zwei Chain-Familien in einer Wallet.** Pali stellt das MetaMask-kompatible `window.ethereum` für EVM-dapps und `window.pali` für Syscoin-UTXO- und Bitcoin-artige Flows bereit. Eine dapp kann mit accountbasierten Assets, UTXOs, PSBTs und xpubs aus einer Erweiterung arbeiten, statt Benutzer zu separaten Wallets zu schicken.
- **Normale Konten und Smart Accounts.** Benutzer können normale EOA-artige Konten, Hardware-Wallet-Konten und Pali Smart Accounts nebeneinander verwenden. Normale Konten sind einfach und portabel. Smart Accounts fügen programmierbare Policy hinzu: Passkeys, wallet-eigene ECDSA-Validatoren, Composite-Threshold-Policies, Guardian-Recovery und benutzerdefinierte Module.
- **Standards zuerst für dapp-Integration.** Pali folgt den Wallet-APIs, die dapps bereits nutzen: EIP-1193, EIP-6963, EIP-2255-Berechtigungen, EIP-5792 `wallet_sendCalls`, EIP-712 Typed Data und MetaMask-kompatibles Request-Verhalten. Pali Smart Accounts verwenden ERC-7579-artige Validator-/Executor-Module und ERC-4337-artige Ausführungsdaten, sodass Account-Verhalten auf öffentlichen Standards statt auf einer Pali-eigenen API basiert.
- **Programmierbare Autorisierung.** In einem Pali Smart Account bleibt die Adresse stabil, aber die Signatur-Policy kann sich weiterentwickeln. Ein Validator entscheidet, wer Aktionen freigeben darf; ein Executor ergänzt Funktionen wie Guardian-Recovery. Dadurch kann ein Team von einem Passkey zu einer Threshold-Policy wechseln, Recovery hinzufügen oder später neue Validator-Typen übernehmen, ohne Gelder an eine neue Adresse zu bewegen.
- **Für stärkere zukünftige Signaturen entworfen.** Weil Autorisierung modular ist, können zukünftige Validatoren Verfahren jenseits heutiger ECDSA- und P-256-Passkeys unterstützen, einschließlich Post-Quanten-Signaturen, sobald sie für die Ziel-Chain praktisch sind. Palis Modell soll stärkere Signaturmodule in dasselbe Konto integrieren, statt Benutzer zu einer Migration zu zwingen.
- **Sicherheit vor Bequemlichkeit.** Pali serialisiert blockierende Freigaben, prüft verbundene Sites und Netzwerkkontext, blockiert riskante Blacklist-Treffer bei Sends und Approvals und hält Guardian-Recovery von Transaktionssignaturen getrennt. Guardians können nach einer Verzögerung beim Wiederherstellen des Zugriffs helfen; sie können nicht heimlich Gelder ausgeben.

Palis Richtung ist **selbstverwaltete programmierbare Konten für echte Benutzer und echte dapps**: schnell genug für den Alltag, standardkonform genug für Entwickler, flexibel genug für Institutionen und konservativ genug, dass sicherheitskritische Kontrolle beim Benutzer und bei der Chain bleibt.

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
