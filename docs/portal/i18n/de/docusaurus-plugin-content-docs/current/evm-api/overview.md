---
title: EVM API Überblick
---

Palis EVM-Provider wird über `window.ethereum` bereitgestellt und ist mit standardmäßigen dapp-Integrationen im MetaMask-Stil kompatibel.

## Häufige Methoden

| Bereich | Methoden |
| --- | --- |
| Verbinden | `eth_requestAccounts`, `eth_accounts` |
| Netzwerk | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| Transaktionen | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| Signatur | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Berechtigungen | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Assets | `wallet_watchAsset` |
| Batches | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkeys | `wallet_createPasskeyAccount` |

## Form eines Provider-Requests

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## Read-only-RPC-Weiterleitung

Pali leitet viele read-only Ethereum JSON-RPC-Methoden an den aktiven RPC-Provider weiter, einschließlich Block-, Transaktions-, Receipt-, Log-, Fee-, Balance-, Code-, Storage- und Proof-Abfragen.

## Nicht unterstützte Subscriptions

`eth_subscribe` und `eth_unsubscribe` werden vom In-Wallet-Provider nicht unterstützt. Verwenden Sie Ihren eigenen WebSocket-RPC-Provider für subscriptionslastigen Anwendungszustand.
