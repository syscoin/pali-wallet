---
title: Provider discovery
---

EVM provider discovery에는 EIP-6963을 사용하고, UTXO/Syscoin discovery에는 `window.pali`를 사용하세요.

## EIP-6963 discovery

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="EIP-6963을 통해 announce된 Pali Wallet을 보여주는 test dapp provider selector" />
</a>
  <figcaption>여러 wallet이 설치된 경우 EIP-6963 Pali provider를 우선 사용하세요.</figcaption>
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

Pali는 EIP-6963 provider로 announce되며, 기존 MetaMask-style dapp과의 호환성을 위해 `window.ethereum`도 유지합니다.

## UTXO provider discovery

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## 실무 권장사항

- EVM dapp: EIP-6963을 우선 사용하고, `window.ethereum`으로 fallback하세요.
- UTXO dapp: `window.pali`를 요구하세요.
- Dual-mode dapp: 두 provider를 모두 유지하고 account/network type에 따라 method를 route하세요.
