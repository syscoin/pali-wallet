---
title: Asset 및 chain
---

Pali는 asset watch와 EVM chain 관리를 위한 일반 wallet method를 지원합니다.

## Asset watch

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

asset이 Pali에 추가되기 전에 사용자가 승인해야 합니다.

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

## Chain 전환

```js
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x39' }],
});
```

## UX guidance

해당 chain이 필요한 action을 사용자가 시작했을 때만 chain change를 요청하세요. page load 중에 강제로 전환하지 마세요.
