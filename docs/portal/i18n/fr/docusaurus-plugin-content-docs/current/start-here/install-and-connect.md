---
title: Installer et se connecter
---

Installez Pali comme extension de navigateur, déverrouillez-le et ouvrez une dapp. Pali injecte des providers dans les pages de premier niveau afin que les applications puissent demander des comptes et des actions.

## Détecter Pali

Utilisez EIP-6963 lorsqu'il est disponible pour les intégrations EVM. Il permet aux utilisateurs et aux dapps de distinguer Pali des autres portefeuilles, même lorsque plusieurs extensions injectent des providers.

```js
const providers = [];

window.addEventListener('eip6963:announceProvider', (event) => {
  providers.push(event.detail);
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

const pali = providers.find(({ info }) => {
  const name = info.name.toLowerCase();
  const rdns = info.rdns.toLowerCase();
  return name.includes('pali') || rdns.includes('pali');
});
```

Pour les flux UTXO et Syscoin, vérifiez `window.pali`.

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## Connecter des comptes EVM

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="Popup de connexion dapp de Pali montrant le site demandeur et la sélection du compte" />
</a>
  <figcaption>Pali montre le site demandeur et le compte avant d'accorder l'accès à la dapp.</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Connecter des comptes UTXO

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Gérer le rejet et l'incompatibilité de réseau

Les utilisateurs peuvent rejeter les demandes de connexion. Pali peut aussi rejeter une méthode lorsque le réseau actif appartient à la mauvaise famille de chaînes, par exemple en appelant `sys_requestAccounts` alors que le portefeuille est en mode EVM.

```js
try {
  await window.pali.request({ method: 'sys_requestAccounts', params: [] });
} catch (error) {
  if (error.code === 4001) {
    console.log('The user rejected the request.');
  } else {
    console.error('Pali request failed', error);
  }
}
```

## Charger une build de développement locale

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="Pali Wallet installé et déverrouillé dans un profil de navigateur propre" />
</a>
  <figcaption>Utilisez un profil de test propre lors de la capture des flux d'installation et de déverrouillage.</figcaption>
</figure>

Depuis le dépôt du portefeuille :

```bash
yarn install
yarn dev:chrome
```

Ensuite, ouvrez `chrome://extensions`, activez Developer Mode, choisissez Load unpacked, puis sélectionnez le répertoire généré `build/chrome`.
