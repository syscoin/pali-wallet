---
title: Provider 发现
---

使用 EIP-6963 进行 EVM provider 发现，使用 `window.pali` 进行 UTXO/Syscoin 发现。

## EIP-6963 发现

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="测试 dapp provider 选择器显示通过 EIP-6963 宣告的 Pali Wallet" />
</a>
  <figcaption>安装多个钱包时，优先使用 EIP-6963 Pali provider。</figcaption>
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

Pali 会作为 EIP-6963 provider 宣告自身，同时也保持 `window.ethereum` 兼容现有的 MetaMask 风格 dapp。

## UTXO provider 发现

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## 实用建议

- EVM dapp：优先使用 EIP-6963，回退到 `window.ethereum`。
- UTXO dapp：要求存在 `window.pali`。
- 双模式 dapp：保留两个 provider，并按账户/网络类型路由方法。
