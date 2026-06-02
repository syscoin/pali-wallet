---
title: Network switching
---

Pali는 EVM network switching, EVM chain addition, UTXO chain switching, UTXO/EVM family switching을 지원합니다.

## EVM chain 추가

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

## EVM chain 전환

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## UTXO와 EVM family 사이 전환

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

## Dapp guidance

Network switching은 user approval로 취급하세요. page load 중에 전환하지 마세요. target network가 필요한 action을 사용자가 시작한 뒤에만 요청하세요.
