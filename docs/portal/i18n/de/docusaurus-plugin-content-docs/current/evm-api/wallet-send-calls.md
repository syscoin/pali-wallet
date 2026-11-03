---
title: wallet_sendCalls
---

Pali unterstützt `wallet_sendCalls` im Stil von EIP-5792 für EVM-Batch-Anfragen. Ein unterstützter Pali Smart Account kann mehrere Calls als eine Account-Ausführung autorisieren.

## Capabilities prüfen

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali meldet atomare Unterstützung für unterstützte Pali Smart Accounts und keine atomare Ausführung für reguläre EOAs.

## Einen Batch senden

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
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

## Verhalten von Smart Accounts

Der Nutzer genehmigt oder lehnt den gesamten angeforderten Batch ab; einzelne Calls lassen sich nicht abwählen. Bei Pali Smart Accounts bereitet Pali den gesamten Batch als eine Account-Ausführung vor, fordert die Autorisierung des aktiven Validators an, prüft die Ziele gegen die Wallet-Blacklist und sendet eine Transaktion. Ein Passkey-Validator verwendet eine WebAuthn-Assertion; konfigurierte lokale ECDSA-Owner signieren den Action-Hash.

## EOA-Verhalten

Bei regulären EVM-Accounts zeigt Pali den gesamten angeforderten Batch zur Genehmigung oder Ablehnung an und sendet seine Calls sequenziell. Das ist keine atomare On-Chain-Ausführung. Für atomare Ausführung verwenden Sie einen unterstützten Pali Smart Account oder einen dafür ausgelegten Contract.

## Statusmethoden

`wallet_getCallsStatus` und `wallet_showCallsStatus` sind gemäß EIP-5792 implementiert. `wallet_getCallsStatus` liefert das Standard-Statusobjekt (`100` ausstehend, `200` bestätigt, `500` zurückgesetzt, `600` teilweise zurückgesetzt) mit On-Chain-Receipts; `wallet_showCallsStatus` öffnet ein schreibgeschütztes Pali-Popup mit denselben Informationen. Von der Dapp gelieferte `id`s in `wallet_sendCalls` werden respektiert und zurückgegeben. Unbekannte Bundle-IDs schlagen mit Fehler `5730` fehl; doppelte Dapp-IDs mit `5720`.
