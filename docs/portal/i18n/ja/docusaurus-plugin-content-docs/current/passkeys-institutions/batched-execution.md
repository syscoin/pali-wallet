---
title: バッチ実行
---

Passkeyスマートアカウントは`wallet_sendCalls`を通じたバッチ実行をサポートします。これにより、ユーザーは1回のウォレット確認と1回のWebAuthn assertionで複数の呼び出しを承認できます。

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="Pali wallet_sendCalls passkey batch review with decoded calldata" />
</a>
  <figcaption>Paliはpasskeyバッチ全体を確認し、1回のWebAuthn承認の前に一般的なトークン呼び出しをデコードします。</figcaption>
</figure>

## 例: approveとtransferFrom

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## アトミックUX

`atomicRequired`がtrueの場合、ユーザーはバッチ全体を承認または拒否するべきです。Paliのpasskey経路は、選択されたすべての呼び出しを単一のスマートアカウント実行として準備します。ビジネスロジックがall-or-nothing動作を必要とする場合、dappsは部分的なバッチ承認をユーザーに求めるべきではありません。

## スポンサーproof capability

スポンサー付きpasskey実行では、該当する場合、dappはcapabilitiesを通じてバッチレベルのスポンサーproofを渡せます。Paliは保存済みアカウントスポンサーメタデータを通じたスポンサーサービス解決もサポートします。

## 未サポートの呼び出しタイプ

Passkey `wallet_sendCalls`は、空のターゲットトランザクションとして表現されるコントラクトデプロイ呼び出しをサポートしません。コントラクトは別にデプロイするか、ターゲットコントラクト呼び出しを使用してください。

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Passkey wallet_sendCalls batch flow"></video>
  <figcaption>Passkeyバッチ実行フロー: ブランド付きイントロ、デコード済み呼び出し、1回のpasskey承認、トランザクション結果。</figcaption>
</figure>
