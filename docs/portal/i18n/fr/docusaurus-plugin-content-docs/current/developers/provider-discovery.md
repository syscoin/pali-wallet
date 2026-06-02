---
title: Découverte du provider
---

Utilisez EIP-6963 pour la découverte de provider EVM et `window.pali` pour la découverte UTXO/Syscoin.

## Découverte EIP-6963

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="Sélecteur de provider de dapp de test montrant Pali Wallet annoncé via EIP-6963" />
</a>
  <figcaption>Préférez le provider Pali EIP-6963 lorsque plusieurs portefeuilles sont installés.</figcaption>
</figure>

```js
export async function getPaliEthereumProvider(timeoutMs = 300) {
  const providers = [];

  function onProvider(event) {
    providers.push(event.detail);
  }

  window.addEventListener('eip6963:announceProvider', onProvider);
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  window.removeEventListener('eip6963:announceProvider', onProvider);

  const match = providers.find(({ info }) => {
    const name = String(info.name || '').toLowerCase();
    const rdns = String(info.rdns || '').toLowerCase();
    return name.includes('pali') || rdns.includes('pali');
  });

  return match?.provider || window.ethereum;
}
```

Pali s'annonce comme provider EIP-6963 et garde aussi `window.ethereum` compatible pour les dapps existantes de style MetaMask.

## Découverte du provider UTXO

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## Recommandation pratique

- Dapp EVM : préférez EIP-6963, avec repli vers `window.ethereum`.
- Dapp UTXO : exigez `window.pali`.
- Dapp bimode : conservez les deux providers et routez les méthodes selon le type de compte/réseau.
