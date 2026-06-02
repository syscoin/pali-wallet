---
title: Bitcoin-style dapp
---

Pali의 UTXO provider는 Syscoin UTXO 및 compatible transaction model을 포함한 Bitcoin-style account flow용 browser dapp을 가능하게 합니다.

## EVM과 달라지는 점

EVM dapp은 보통 하나의 account에 transaction object 서명을 요청합니다. UTXO dapp은 보통 다음을 수행합니다.

1. account 및 UTXO state를 읽습니다.
2. PSBT를 만듭니다.
3. change address를 포함합니다.
4. wallet에 서명을 요청합니다.
5. finalize하고 broadcast합니다.

## 최소 통합 형태

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Best practice

- PSBT를 deterministically build하고 앱에서 사용자에게 transaction summary를 보여주세요.
- receive address를 재사용하지 말고 Pali의 change address를 사용하세요.
- testnet/mainnet 차이를 처리하세요.
- wallet lock, rejection, network mismatch error를 처리하세요.
- 사용자가 의미 있는 action을 시작하기 전에는 xpub 또는 signing을 요청하지 마세요.
