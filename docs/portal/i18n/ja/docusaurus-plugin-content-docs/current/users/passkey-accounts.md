---
title: Passkeyアカウント
---

PasskeyアカウントはWebAuthn credentialsによって制御されるEVMスマートアカウントです。通常のEOA秘密鍵で署名する代わりに、ユーザーはブラウザとオペレーティングシステムが提供するデバイスまたはアカウントのpasskey UIで操作を承認します。

内部では、WebAuthn passkeysはP-256署名を使用します。zkSYS passkeyアカウントは、それらのP-256 proofsをスマートアカウント/ファクトリーシステムで検証できるように構築されています。そのため、生体認証またはプラットフォームpasskey承認でオンチェーン操作を承認できます。

## なぜpasskeyアカウントを使うのか

- 機関向けオンボーディングを簡単にするため。
- スマートアカウントpolicyをサポートするため。
- gasまたは共同承認のための任意のスポンサーサービス。
- 1回のユーザー承認によるバッチ実行。
- ローカルウォレットメタデータがない場合のオンチェーンレジストリデータからの復元。

## 共有passkeysと個別passkeys

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="Pali settings screen for creating a passkey account" />
</a>
  <figcaption>ユーザーはSettingsからもdappリクエストからもpasskeyアカウントを作成できます。</figcaption>
</figure>

Paliは、共有ウォレットpasskeyプロファイルを使用することも、アカウント用に個別のpasskey credentialを作成することもできます。共有passkeysは、ウォレットが制御するpasskeyを1つ持ちたいユーザーに便利です。個別passkeysは、機関がサービスまたはpolicyごとにcredentialsを分離するのに役立ちます。

## デプロイ

Passkeyスマートアカウントは、オンチェーンにデプロイされる前にcounterfactualアドレスとして存在する場合があります。ネットワークと資金提供経路が対応していれば、最初の実行でアカウントをデプロイし、要求された操作を1つのフローで実行できます。

アカウントがまだデプロイされていない場合は、passkeyアカウントまたはデプロイgas支払者に十分なネイティブトークンがあることを確認するか、デプロイフローをサポートする機関スポンサー経路を使用してください。

## ネットワークサポート

Passkeyアカウントには、zkSYS passkeyスマートアカウントコントラクトとP-256検証サポートが必要です。このPaliビルドでは、`zkTanenbaum`テストネットがpasskeyアカウント作成用に設定されています。zkSYS本番サポートは、本番ファクトリーアドレスがウォレットに設定されると同じモデルを使用します。

## 復元

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Pali passkey account policy settings screen" />
</a>
  <figcaption>passkey policy画面には、利用可能な場合にスポンサーmode、signer、URL、バックアップ状態が表示されます。</figcaption>
</figure>

ローカルウォレット状態が削除された場合や新しいデバイスにPaliをインストールした場合、Paliはオンチェーンのファクトリーレジストリとイベントログからpasskeyスマートアカウントを復元できます。同じpasskey credentialにアクセスできるPaliインストールであれば、WebAuthn assertion後に一致するデプロイ済みアカウントを検出し、ローカルに既にあるアカウントをスキップして、選択したアカウントをインポートできます。

## ガーディアンによる復元

Paliは、本番環境のpasskeyアカウント復元にセルフカストディ型の復元ガーディアンを使用します。ガーディアンは、アクティブなpasskeyとは別にユーザーが管理するバックアップEVMウォレット、インポート済みアカウント、またはハードウェアウォレットです。passkeyがまだアカウントを管理している間、ユーザーはpolicy画面からガーディアンの追加・削除や復元待機期間の更新を行えます。

ガーディアン復元は即時には完了しません。復元を開始すると、置き換え用のpasskeyを作成し、設定済みガーディアンに復元意図への署名を求め、タイムロック付きの復元リクエストを送信します。待機期間が過ぎると、誰でも復元トランザクションをfinalizeできます。その後、ユーザーは通常のpasskey復元を使って、置き換え用passkeyでアカウントをインポートできます。

ガーディアン署名は、チェーン、ガーディアン復元validator、アカウントアドレス、置き換え用passkey identity、復元nonce、有効期限に結び付けられます。これにより、ガーディアン署名を別のアカウント、チェーン、またはpasskeyに再利用できなくなりつつ、復元開始トランザクションのリレーは可能になります。

技術的な注記: ガーディアン復元validatorは、アカウントごとにガーディアン集合、しきい値、遅延、保留中の復元を保存します。PaliはUXを明確にするため現在はシンプルな1-of-1ガーディアンフローを表示していますが、コントラクトは1-of-NやM-of-Nなどのしきい値policyをサポートしています。

## Dappが作成するアカウント

Dappは`wallet_createPasskeyAccount`中にガーディアン復元メタデータを要求できます:

```json
{
  "label": "Trading desk",
  "recovery": {
    "guardian": {
      "address": "0x...",
      "delay": 86400
    }
  }
}
```

Paliは、アカウント作成時にDappが提供したガーディアンを自動的には設定しません。ウォレットがそのアドレスの真正性をまだ確認できないためです。Dappがガーディアンを提案した場合、Paliはユーザーに警告したうえでアカウント作成を許可します。その後、ユーザーはpasskeyアカウントのpolicy画面から自分が信頼するガーディアンを追加できます。将来のバージョンでは、既知のデフォルトガーディアン向けの信頼済み辞書やホワイトリストを追加する可能性があります。
