---
title: EVM 및 UTXO 모드
---

Pali는 account-based EVM network와 UTXO-based network를 지원합니다. account model이 근본적으로 다르기 때문에 extension은 별도의 provider surface를 사용합니다.

## EVM mode

EVM mode는 `window.ethereum`을 사용하는 dapp을 위한 것입니다. MetaMask-style account request, transaction, signature, permission, token watch request, network management를 지원합니다.

예시:

- Rollux 및 Syscoin NEVM dapp
- ERC-20, ERC-721, ERC-1155 interaction
- EIP-712 typed data signing
- Pali smart account creation 및 execution

## UTXO mode

UTXO mode는 `window.pali`를 사용하는 dapp을 위한 것입니다. Syscoin UTXO account state, xpub-aware integration, PSBT signing, transaction broadcast, SPT asset flow를 지원합니다.

예시:

- Syscoin UTXO asset application
- Bitcoin-like PSBT workflow
- change address가 필요한 dapp
- UTXO transaction history를 읽는 dapp

## 모드 전환

dapp이 잘못된 chain family의 method를 요청하면 Pali는 network switch를 요구할 수 있습니다. dapp은 이러한 error를 깔끔하게 처리하고 사용자를 올바른 network로 안내해야 합니다.

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

UTXO와 EVM context 사이를 전환하면 active account family가 바뀌기 때문에 dapp을 다시 연결해야 할 수 있습니다.
