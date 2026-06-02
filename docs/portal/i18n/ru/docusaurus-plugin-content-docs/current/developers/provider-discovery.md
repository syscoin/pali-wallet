---
title: Обнаружение провайдера
---

Используйте EIP-6963 для обнаружения EVM-провайдера и `window.pali` для обнаружения UTXO/Syscoin.

## Обнаружение EIP-6963

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="Селектор провайдера test dapp, показывающий Pali Wallet, объявленный через EIP-6963" />
</a>
  <figcaption>Предпочитайте EIP-6963 провайдер Pali, когда установлено несколько кошельков.</figcaption>
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

Pali объявляет себя как EIP-6963 provider и также сохраняет совместимость `window.ethereum` для существующих MetaMask-style dapps.

## Обнаружение UTXO provider

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## Практическая рекомендация

- EVM dapp: предпочитайте EIP-6963, fallback к `window.ethereum`.
- UTXO dapp: требуйте `window.pali`.
- Dual-mode dapp: держите оба провайдера и маршрутизируйте методы по типу аккаунта/сети.
