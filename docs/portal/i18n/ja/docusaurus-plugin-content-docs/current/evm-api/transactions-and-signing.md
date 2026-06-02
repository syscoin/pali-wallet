---
title: トランザクションと署名
---

トランザクション、個人メッセージ、typed dataにはEVMプロバイダーを使用します。

## トランザクションを送信する

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Pali EVM transaction review screen" />
</a>
  <figcaption>トランザクションリクエストは、署名とブロードキャストの前にPaliで確認されます。</figcaption>
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
  <figcaption>Paliはユーザー承認の前にtyped dataを検証して表示します。</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Paliは署名ポップアップを表示する前にtyped data構造を検証します。dappsは標準的なEIP-712 JSONを使用し、ウォレット固有の解析の癖に依存しないでください。

## Passkeyアカウントと署名

Passkeyスマートアカウントは、WebAuthnに裏付けられたスマートアカウントロジックを通じて、トランザクションと署名フローを承認できます。ユーザーは引き続きPali内とプラットフォームpasskeyプロンプトを通じて承認します。
