---
title: Transactions and signing
---

Use the EVM provider for transactions, personal messages, and typed data.

## Send a transaction

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Pali EVM transaction review screen" />
</a>
  <figcaption>Transaction requests are reviewed in Pali before signing and broadcast.</figcaption>
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
  <img src="/img/screens/typed-data-review.png" alt="Pali typed data signing review screen" />
</a>
  <figcaption>Pali validates and displays typed data before user approval.</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Pali validates typed data structure before showing the signing popup. Dapps should use canonical EIP-712 JSON and avoid relying on wallet-specific parsing quirks.

## Passkey accounts and signing

Passkey smart accounts can approve transactions and signing flows through WebAuthn-backed smart account logic. The user still approves in Pali and through the platform passkey prompt.
