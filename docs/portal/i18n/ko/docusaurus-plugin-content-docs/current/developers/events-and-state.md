---
title: 이벤트 및 provider state
---

사용자가 account, network, lock state 또는 UTXO state를 변경할 때 app이 동기화되도록 provider event를 listen하세요.

## EVM event

```js
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('EVM accounts', accounts);
});

window.ethereum.on('chainChanged', (chainId) => {
  console.log('EVM chain', chainId);
});

window.ethereum.on('disconnect', (error) => {
  console.warn('Provider disconnected', error);
});
```

## Pali custom event

Pali는 extension provider가 사용하는 custom wallet notification도 emit합니다.

| Event | 의미 |
| --- | --- |
| `pali_accountsChanged` | 연결된 account가 변경되었습니다. |
| `pali_chainChanged` | active chain이 변경되었습니다. |
| `pali_unlockStateChanged` | wallet lock state가 변경되었습니다. |
| `pali_isBitcoinBased` | active UTXO family가 변경되었습니다. |
| `pali_xpubChanged` | 연결된 UTXO xpub이 변경되었습니다. |
| `pali_blockExplorerChanged` | active UTXO explorer가 변경되었습니다. |

## Provider state method

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

Provider state는 initialization에 유용하지만, 이를 명시적인 account permission check의 대체물로 취급하지 마세요.
