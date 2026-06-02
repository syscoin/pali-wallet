---
title: Provider-Discovery
---

Verwenden Sie EIP-6963 für EVM-Provider-Discovery und `window.pali` für UTXO/Syscoin-Discovery.

## EIP-6963-Discovery

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="Provider-Auswahl der Test-dapp, die Pali Wallet über EIP-6963 angekündigt zeigt" />
</a>
  <figcaption>Bevorzugen Sie den EIP-6963-Pali-Provider, wenn mehrere Wallets installiert sind.</figcaption>
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

Pali kündigt sich als EIP-6963-Provider an und hält außerdem `window.ethereum` für vorhandene MetaMask-artige dapps kompatibel.

## UTXO-Provider-Discovery

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## Praktische Empfehlung

- EVM-dapp: EIP-6963 bevorzugen, Fallback auf `window.ethereum`.
- UTXO-dapp: `window.pali` verlangen.
- Dual-Mode-dapp: Beide Provider behalten und Methoden nach Account-/Netzwerktyp routen.
