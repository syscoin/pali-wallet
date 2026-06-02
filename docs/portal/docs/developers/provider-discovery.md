---
title: Provider discovery
---

Use EIP-6963 for EVM provider discovery and `window.pali` for UTXO/Syscoin discovery.

## EIP-6963 discovery

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="Test dapp provider selector showing Pali Wallet announced through EIP-6963" />
</a>
  <figcaption>Prefer the EIP-6963 Pali provider when multiple wallets are installed.</figcaption>
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

Pali announces as an EIP-6963 provider and also keeps `window.ethereum` compatible for existing MetaMask-style dapps.

## UTXO provider discovery

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## Practical recommendation

- EVM dapp: prefer EIP-6963, fallback to `window.ethereum`.
- UTXO dapp: require `window.pali`.
- Dual-mode dapp: keep both providers and route methods by account/network type.
