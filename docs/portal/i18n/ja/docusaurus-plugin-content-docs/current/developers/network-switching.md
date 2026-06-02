---
title: ネットワーク切り替え
---

PaliはEVMネットワーク切り替え、EVMチェーン追加、UTXOチェーン切り替え、UTXO/EVMファミリー切り替えをサポートします。

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

## EVMチェーンを切り替える

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## UTXOファミリーとEVMファミリーを切り替える

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

## dapp向けガイダンス

ネットワーク切り替えはユーザー承認として扱ってください。ページ読み込み時の切り替えは避けてください。対象ネットワークを必要とする操作をユーザーが開始した後にのみ求めてください。
