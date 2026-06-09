---
title: Transaction 및 signing
---

transaction, personal message, typed data에는 EVM provider를 사용하세요.

## Transaction 전송

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Pali EVM transaction review 화면" />
</a>
  <figcaption>Transaction request는 signing 및 broadcast 전에 Pali에서 검토됩니다.</figcaption>
</figure>

```js
const [from] = await window.ethereum.request({
  method: 'eth_requestAccounts',
});

const hash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [
    {
      from,
      to: '0x0000000000000000000000000000000000000000',
      value: '0x0',
      data: '0x',
    },
  ],
});
```

## Personal sign

```js
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f2050616c69', from],
});
```

## Typed data sign

<figure>
  <a className="pali-media-link" href="/img/screens/typed-data-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/typed-data-review.png" alt="Pali typed data signing review 화면" />
</a>
  <figcaption>Pali는 user approval 전에 typed data를 검증하고 표시합니다.</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Pali는 signing popup을 표시하기 전에 typed data structure를 검증합니다. dapp은 canonical EIP-712 JSON을 사용하고 wallet-specific parsing quirk에 의존하지 않아야 합니다.

## Passkey 계정 및 signing

Pali smart account는 WebAuthn-backed smart account logic을 통해 transaction과 signing flow를 승인할 수 있습니다. 사용자는 여전히 Pali와 platform passkey prompt를 통해 승인합니다.
