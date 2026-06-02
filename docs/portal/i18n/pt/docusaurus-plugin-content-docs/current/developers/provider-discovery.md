---
title: Descoberta de provider
---

Use EIP-6963 para descoberta de provider EVM e `window.pali` para descoberta UTXO/Syscoin.

## Descoberta EIP-6963

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="Seletor de provider da dapp de teste mostrando a Pali Wallet anunciada por EIP-6963" />
</a>
  <figcaption>Prefira o provider Pali EIP-6963 quando várias carteiras estiverem instaladas.</figcaption>
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

A Pali se anuncia como um provider EIP-6963 e também mantém `window.ethereum` compatível para dapps existentes no estilo MetaMask.

## Descoberta de provider UTXO

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## Recomendação prática

- Dapp EVM: prefira EIP-6963, com fallback para `window.ethereum`.
- Dapp UTXO: exija `window.pali`.
- Dapp de modo duplo: mantenha ambos os providers e roteie métodos por tipo de conta/rede.
