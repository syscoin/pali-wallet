---
title: Descubrimiento de proveedor
---

Usa EIP-6963 para el descubrimiento de proveedor EVM y `window.pali` para el descubrimiento UTXO/Syscoin.

## Descubrimiento EIP-6963

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="Selector de proveedor de dapp de prueba que muestra Pali Wallet anunciada mediante EIP-6963" />
</a>
  <figcaption>Prefiere el proveedor Pali EIP-6963 cuando hay varias billeteras instaladas.</figcaption>
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

Pali se anuncia como proveedor EIP-6963 y también mantiene `window.ethereum` compatible para dapps existentes de estilo MetaMask.

## Descubrimiento de proveedor UTXO

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## Recomendación práctica

- Dapp EVM: prefiere EIP-6963, con fallback a `window.ethereum`.
- Dapp UTXO: requiere `window.pali`.
- Dapp de doble modo: conserva ambos proveedores y enruta métodos por tipo de cuenta/red.
