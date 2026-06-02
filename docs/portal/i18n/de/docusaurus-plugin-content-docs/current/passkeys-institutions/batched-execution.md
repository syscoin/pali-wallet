---
title: Batch-Ausführung
---

Passkey Smart Accounts unterstützen Batch-Ausführung über `wallet_sendCalls`. Dadurch kann der Benutzer mehrere Calls mit einer Wallet-Prüfung und einer WebAuthn-Assertion freigeben.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="Pali wallet_sendCalls-Passkey-Batch-Prüfung mit decodierter calldata" />
</a>
  <figcaption>Pali prüft den vollständigen Passkey-Batch und decodiert gängige Token-Calls vor einer WebAuthn-Freigabe.</figcaption>
</figure>

## Beispiel: approve und transferFrom

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
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## Atomare UX

Wenn `atomicRequired` true ist, sollte der Benutzer den gesamten Batch freigeben oder ablehnen. Palis Passkey-Pfad bereitet alle ausgewählten Calls als eine einzelne Smart-Account-Ausführung vor. dapps sollten Benutzer nicht bitten, Teil-Batches freizugeben, wenn die Geschäftslogik Alles-oder-nichts-Verhalten erfordert.

## Sponsor-Proof-Capability

Für gesponserte Passkey-Ausführung kann eine dapp, sofern anwendbar, einen Batch-Level-Sponsor-Proof über Capabilities übergeben. Pali unterstützt außerdem Sponsor-Service-Auflösung über gespeicherte Account-Sponsor-Metadaten.

## Nicht unterstützter Call-Typ

Passkey-`wallet_sendCalls` unterstützt keine Contract-Deployment-Calls, die als leere Zieltransaktionen ausgedrückt sind. Deployen Sie Contracts separat oder verwenden Sie einen Ziel-Contract-Call.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Passkey wallet_sendCalls-Batch-Flow"></video>
  <figcaption>Passkey-Batch-Ausführungs-Flow: gebrandetes Intro, decodierte Calls, eine Passkey-Freigabe, Transaktionsergebnis.</figcaption>
</figure>
