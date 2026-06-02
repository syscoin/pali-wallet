---
title: 交易和签名
---

使用 EVM provider 处理交易、personal message 和 typed data。

## 发送交易

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Pali EVM 交易审核界面" />
</a>
  <figcaption>交易请求会先在 Pali 中审核，然后再签名和广播。</figcaption>
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

## Personal 签名

```js
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f2050616c69', from],
});
```

## Typed data 签名

<figure>
  <a className="pali-media-link" href="/img/screens/typed-data-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/typed-data-review.png" alt="Pali typed data 签名审核界面" />
</a>
  <figcaption>Pali 会在用户批准前验证并显示 typed data。</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Pali 会在显示签名弹窗前验证 typed data 结构。dapp 应使用规范的 EIP-712 JSON，并避免依赖钱包特定的解析怪癖。

## Passkey 账户和签名

Passkey 智能账户可以通过 WebAuthn 支持的智能账户逻辑批准交易和签名流程。用户仍然需要在 Pali 中批准，并通过平台 Passkey 提示批准。
