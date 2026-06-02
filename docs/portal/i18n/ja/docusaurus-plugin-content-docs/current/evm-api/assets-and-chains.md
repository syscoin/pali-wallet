---
title: アセットとチェーン
---

Paliは、アセット監視とEVMチェーン管理のための一般的なウォレットメソッドをサポートします。

## アセットを監視する

```js
await window.ethereum.request({
  method: 'wallet_watchAsset',
  params: {
    type: 'ERC20',
    options: {
      address: tokenAddress,
      symbol: 'TOKEN',
      decimals: 18,
      image: 'https://example.com/token.png',
    },
  },
});
```

アセットがPaliに追加される前に、ユーザーが承認する必要があります。

## EVMチェーンを追加する

```js
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [
    {
      chainId: '0x39',
      chainName: 'Syscoin NEVM',
      nativeCurrency: { name: 'Syscoin', symbol: 'SYS', decimals: 18 },
      rpcUrls: ['https://rpc.syscoin.org'],
      blockExplorerUrls: ['https://explorer.syscoin.org'],
    },
  ],
});
```

## チェーンを切り替える

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## UXガイダンス

ユーザーがそのチェーンを必要とする操作を開始した場合にのみ、チェーン変更を求めてください。ページ読み込み中に強制的に切り替えないでください。
