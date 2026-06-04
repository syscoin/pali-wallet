---
title: wallet_sendCalls
---

Pali unterstützt `wallet_sendCalls` im EIP-5792-Stil für EVM-Batch-Requests. Dies ist besonders wichtig für Passkey Smart Accounts, bei denen mehrere Calls mit einer einzigen WebAuthn-Assertion autorisiert werden können.

## Capabilities prüfen

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali meldet atomare Unterstützung für Passkey Smart Accounts und nicht unterstützte atomare Ausführung für normale EOAs.

## Einen Batch senden

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## Passkey-Verhalten

Für Passkey Smart Accounts bereitet Pali alle ausgewählten Calls als einen Smart-Account-Ausführungs-Batch vor, fordert eine Passkey-Assertion an und sendet eine Transaktion. Lokale Passkey-Accounts repräsentieren bestätigte on-chain Deployments.

## EOA-Verhalten

Für normale EVM-Accounts präsentiert Pali die Calls und sendet ausgewählte Calls sequenziell. Das ist nicht dasselbe wie on-chain Atomicity. Wenn eine dapp echte atomare Ausführung benötigt, verwenden Sie einen Passkey Smart Account oder einen Contract, der für atomare Batch-Calls entwickelt wurde.

## Statusmethoden

`wallet_getCallsStatus` und `wallet_showCallsStatus` sind aus Kompatibilitätsgründen vorhanden, aber persistenter Bundle-Status ist nicht implementiert. Behandeln Sie das unmittelbare `wallet_sendCalls`-Ergebnis und den Transaktions-Hash als die nützliche Ausgabe.
