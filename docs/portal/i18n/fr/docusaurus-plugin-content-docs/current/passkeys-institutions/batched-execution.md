---
title: Exécution par lots
---

Les comptes intelligents Pali prennent en charge l’exécution par lots via `wallet_sendCalls`. L’utilisateur examine plusieurs appels et les autorise comme une seule action de compte.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>Pali examine le lot complet du compte intelligent et décode les appels de token courants avant une seule autorisation du compte.</figcaption>
</figure>

```js
await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [{ version: '2.0.0', from: smartAccount, chainId: '0x39', atomicRequired: true, calls }],
});
```

Pour chaque demande `wallet_sendCalls`, l’utilisateur approuve ou refuse tout le lot sans pouvoir désélectionner des appels. Un compte intelligent Pali compatible prépare le lot complet en une exécution. Les appels EOA sont séquentiels ; ceux déjà diffusés ne peuvent pas être annulés si un appel ultérieur échoue. Ce parcours de compte intelligent ne prend pas en charge les déploiements de contrat à destination vide.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>Une seule approbation exécute tout le lot de manière atomique.</figcaption>
</figure>
