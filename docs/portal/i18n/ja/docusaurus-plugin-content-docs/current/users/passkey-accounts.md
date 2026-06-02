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

ローカルウォレット状態が削除された場合やウォレットを復元した場合、Paliはオンチェーンのファクトリーレジストリとイベントログからpasskeyスマートアカウントを復元できます。復元には、関連するpasskeyからのWebAuthn assertionが引き続き必要です。
