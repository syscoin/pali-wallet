---
title: プロバイダーディスカバリー
---

EVMプロバイダーディスカバリーにはEIP-6963を使用し、UTXO/Syscoinディスカバリーには`window.pali`を使用します。

## EIP-6963ディスカバリー

<figure>
  <a className="pali-media-link" href="/img/screens/eip6963-pali-provider.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/eip6963-pali-provider.png" alt="Test dapp provider selector showing Pali Wallet announced through EIP-6963" />
</a>
  <figcaption>複数のウォレットがインストールされている場合は、EIP-6963のPaliプロバイダーを優先してください。</figcaption>
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

PaliはEIP-6963プロバイダーとしてアナウンスし、既存のMetaMaskスタイルdapps向けに`window.ethereum`の互換性も維持します。

## UTXOプロバイダーディスカバリー

```js
export function getPaliUtxoProvider() {
  if (!window.pali) {
    throw new Error('Pali UTXO provider not found.');
  }
  return window.pali;
}
```

## 実践的な推奨

- EVM dapp: EIP-6963を優先し、`window.ethereum`へフォールバックします。
- UTXO dapp: `window.pali`を必須にします。
- デュアルモードdapp: 両方のプロバイダーを保持し、アカウント/ネットワークタイプに応じてメソッドをルーティングします。
