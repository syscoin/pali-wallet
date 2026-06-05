---
title: スポンサーサービス
---

スポンサーサービスは、passkeyスマートアカウント実行policyに参加する、機関が管理するエンドポイントです。

## スポンサーオブジェクト


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
| `url` | Paliがスポンサー実行サポートのために接続するoptionalなサービスエンドポイント。service URLがなければremote gas sponsorがないため、Paliは`gasOnly` sponsorshipでこれを要求します。 |
| `signer` | 必須policy proofsで期待されるスポンサーsignerアドレス。`required` modeで必要です。 |
| `policyText` | ウォレットメタデータに保存されるユーザー向け説明。オンチェーン強制ではありません。 |

## オンチェーンpolicy

スマートアカウントpolicyはmode、signer、公開sponsor URLを保存します。policy textは表示に使用されるウォレットメタデータです。

## 冪等性

スポンサー実行リクエストは、passkeyアクションハッシュから派生したidempotency keyを使用します。スポンサーサービスは、同じkeyを持つ繰り返しリクエストを同じアクションとして扱うべきです。

## 必須スポンサーmode

`required` modeでは、スポンサーproofは設定済みsignerへ復元できる必要があります。スポンサーURLはoptionalです。URLが設定されている場合、Paliはスポンサーサービスからproofを取得できます。また、設定済みsignerがwallet内のavailable accountである場合はlocal signingを使用できます。Paliがスポンサーproofを取得または検証できない場合、実行は失敗します。

Gas paymentはスポンサーauthorizationとは別です。有効なスポンサーproofが利用可能になった後も、Paliはpasskey execution用に選択されたfunded software accountからgasを支払えます。

## Gas-only mode

`gasOnly` modeでは、スポンサーサービスがリレーまたはgas支払いを支援する場合があります。PaliはこのmodeにスポンサーURLを要求します。URLがgas sponsorship serviceを識別するためです。スポンサーシップが利用できない場合、policyが許す範囲でPaliはwallet-gas実行へフォールバックできます。

## 機関向けガイダンス

- ユーザーごとに安定したsponsor URLsを使用してください。
- signer keysはdapp frontendではなく、機関インフラ内に保管してください。
- policy textは短く、具体的で、理解しやすいものにしてください。
- 繰り返されるidempotency keysに対して一貫したステータスを返してください。
- 失敗したスポンサーリクエストと期限切れexecution deadlinesを監視してください。
