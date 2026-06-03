---
title: スポンサーサービス
---

スポンサーサービスは、passkeyスマートアカウント実行policyに参加する、機関が管理するエンドポイントです。

## スポンサーオブジェクト

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="Pali sponsor relay pending and success states" />
</a>
  <figcaption>スポンサー付き実行では、保留、成功、失敗の状態をユーザーに明確に示すべきです。</figcaption>
</figure>

```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## フィールドの意味

| フィールド | 目的 |
| --- | --- |
| `mode` | `disabled`、`gasOnly`、または`required`。 |
| `url` | Paliがスポンサー実行サポートのために接続するサービスエンドポイント。 |
| `signer` | 必須policy proofsで期待されるスポンサーsignerアドレス。 |
| `policyText` | ウォレットメタデータに保存されるユーザー向け説明。オンチェーン強制ではありません。 |

## オンチェーンpolicy

スマートアカウントpolicyはmode、signer、公開sponsor URLを保存します。policy textは表示に使用されるウォレットメタデータです。

## 冪等性

スポンサー実行リクエストは、passkeyアクションハッシュから派生したidempotency keyを使用します。スポンサーサービスは、同じkeyを持つ繰り返しリクエストを同じアクションとして扱うべきです。

## 必須スポンサーmode

`required` modeでは、スポンサーproofは設定済みsignerへ復元できる必要があります。Paliがスポンサーproofを取得または検証できない場合、実行は失敗します。

## Gas-only mode

`gasOnly` modeでは、スポンサーサービスがリレーまたはgas支払いを支援する場合があります。スポンサーシップが利用できない場合、policyが許す範囲でPaliはwallet-gas実行へフォールバックできます。

## 機関向けガイダンス

- ユーザーごとに安定したsponsor URLsを使用してください。
- signer keysはdapp frontendではなく、機関インフラ内に保管してください。
- policy textは短く、具体的で、理解しやすいものにしてください。
- 繰り返されるidempotency keysに対して一貫したステータスを返してください。
- 失敗したスポンサーリクエストと期限切れexecution deadlinesを監視してください。
