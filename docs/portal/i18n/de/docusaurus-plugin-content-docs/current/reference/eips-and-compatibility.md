---
title: EIPs und Kompatibilität
---

Pali zielt darauf ab, die Wallet-Standards zu unterstützen, die reale dapps verwenden, und ergänzt UTXO- und Passkey-Fähigkeiten.

## EVM-Wallet-Standards

| Standard | Pali-Unterstützung |
| --- | --- |
| EIP-1193 | Provider-Requests/Events/Fehler über `window.ethereum`. |
| EIP-6963 | Multi-Wallet-Discovery und Provider-Ankündigung. |
| EIP-1102 | `enable()` ist zugunsten von Account-Request-Methoden deprecated. |
| EIP-1474 | Fehlercodes im JSON-RPC-Stil für Ethereum RPC. |
| EIP-2255 | Wallet-Berechtigungsmethoden. |
| EIP-3085 | `wallet_addEthereumChain`. |
| EIP-3326 | `wallet_switchEthereumChain`. |
| EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities`, Status-Kompatibilitätsmethoden. |
| EIP-712 | Typed data-Signatur über `eth_signTypedData_v4` und verwandte Methoden. |
| EIP-747 | `wallet_watchAsset`. |

## MetaMask-Kompatibilität

Pali stellt `window.ethereum` für dapps bereit, die Verhalten im MetaMask-Stil erwarten. Es markiert den Provider außerdem für Legacy-Integrationen als MetaMask-kompatibel und kündigt sich über EIP-6963 für moderne Wallet-Auswahl an.

## Pali-Erweiterungen über EVM hinaus

Pali fügt `window.pali` für UTXO/Syscoin-Flows hinzu. Diese Methoden sind keine Ethereum EIPs; sie sind Palis Browser-Wallet-API für UTXO-Account-Zustand, PSBT-Signatur, Syscoin-Assets und Bitcoin-artige dapp-Flows.

## Kompatibilitätshinweise

- EVM-Subscriptions werden vom Erweiterungs-Provider nicht unterstützt.
- `wallet_getCallsStatus` und `wallet_showCallsStatus` sind Kompatibilitäts-Stubs.
- EOA-`wallet_sendCalls`-Ausführung ist sequenziell, keine echte on-chain Atomicity.
- UTXO- und EVM-Netzwerkfamilien sind durch Provider-Oberfläche und Wallet-Zustand getrennt.
