---
title: Vue d'ensemble de l'API UTXO et Syscoin
---

Pali expose les capacités UTXO et Syscoin via `window.pali`.

Utilisez ce provider lorsque votre app a besoin de :

- Accès au compte Syscoin UTXO.
- Signature PSBT.
- Diffusion de transaction.
- Adresses de rendu de monnaie.
- xpub du compte connecté.
- Historique des transactions UTXO.
- Métadonnées et avoirs d'actifs Syscoin Platform Token.

## Connexion

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Popup de connexion UTXO de Pali pour une dapp Syscoin" />
</a>
  <figcaption>Les dapps UTXO se connectent via <code>window.pali</code>, pas <code>window.ethereum</code>.</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Utilitaires du provider

`window.pali` inclut des méthodes RPC basées sur des requêtes et des méthodes d'assistance `_sys` pour les lectures courantes d'actifs Syscoin.

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## Règles de famille de chaînes

Les méthodes UTXO exigent que le portefeuille soit dans un contexte réseau UTXO/Syscoin compatible. Si votre app prend aussi en charge EVM, gardez les appels de provider séparés et gérez explicitement le changement de mode.
