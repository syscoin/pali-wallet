---
title: Paliスマートアカウント
---

Paliスマートアカウントは、Paliがユーザーのために作成・接続・操作できるコントラクトアカウントです。一般ユーザーには通常のウォレットのように見えます。dappの要求を確認し、passkeyまたはウォレットキーで承認し、Paliがトランザクションを送信します。内部ではモジュール式で、validatorが承認を行い、executorが復元などの機能を追加します。

## シンプルな考え方

- 1つのアカウントアドレスが資産を保持し、dappにもそのアドレスが見えます。
- passkey、ECDSA、composite policyで承認できます。
- Guardian recoveryは遅延後に active validator を置き換えられます。
- `wallet_sendCalls` は複数の call を1つの atomic action として実行できます。

## 技術モデル

`PaliSmartAccount` は call を実行し、ERC-7579風のモジュールで署名を検証します。`PaliSmartAccountFactory` は deterministic address を導出してアカウントを deploy します。Paliは内部でERC-4337風の encoding を使い、EIP-1271でcontract signatureを検証します。

## 2つの役割: validatorが署名し、guardianが復元する

ERC-7579はモジュールの役割を分離しており、Paliはこの分離を意図的に活用しています。

- **Validator**は、passkey、ECDSA、composite policyなど、通常のアカウント承認の署名を検証します。
- **Executor**は、インストール済みモジュールを通じてアカウントの操作を実行できます。Paliのguardianモジュールには設定した閾値と待機時間が必要です。ウォレットの案内付きフローは有効なvalidatorを置き換えますが、オンチェーンモジュールはそのUI操作だけに限定されていません。

したがってguardianは、アカウントに対する遅延付きの権限を持ちます。閾値を満たすguardianが侵害されると、制御や資金が危険になります。現在の所有者は待機中に対応できますが、悪意のある実行より前に保護操作を確定させる必要があります。[ガーディアン復旧](../users/smart-account-validators)を参照してください。

## Composite署名policy

composite validatorは子validatorをthresholdの下で組み合わせ、1つのアカウントをpolicyエンジンに変えます。

- **1-of-N** — 複数のauthenticatorのうちどれか1つで承認できます。各デバイスにpasskeyを置く個人アカウントに便利です。
- **t-of-N** — 定足数の承認が必要です。共有トレジャリー、デスク、チーム管理アカウントに自然な形です。
- **N-of-N** — 設定されたすべてのvalidatorの承認が必要です。最大限の保証が必要なアカウント向けです。

現在のPaliは、ローカルで利用可能な組み込みの子validatorの承認を閾値まで集めます。このバージョンでは、入れ子のcompositeや外部・別デバイスからの承認収集はサポートしていません。guardian recoveryは有効なvalidator policyから独立しています。

## Validatorの俊敏性とポスト量子への備え

対応設定済みのネットワークでは、Paliはウォレット所有のECDSA、P-256 WebAuthnパスキー、SLH-DSA、複合バリデーターをサポートします。対応するオンチェーンモジュールがデプロイ済みで、必要なローカル鍵や認証情報が利用可能であることが必要です。交換可能なモジュールにより、将来の署名方式も同じアカウントアドレスで導入できます。バリデーターを変更しても、資金、履歴、連携は移動しません。

guardianモジュールは、通常のアドレスのECDSA承認とコントラクトアカウントのERC-1271承認を検証します。Paliは、ローカルの鍵ベースのguardianと、署名可能なデプロイ済みローカルのスマートアカウントguardian（SLH-DSAを含む）を利用できます。ローカルで署名できない外部guardianには外部の承認フローが必要です。

## 企業・チーム向け

企業はPaliスマートアカウントを単なるpasskey loginではなく、アカウント基盤として扱うべきです。passkeyは低摩擦のonboardingに、ECDSAやcomposite validatorはチームやhardware wallet管理に、guardian recoveryは遅延付きの置き換えに使えます。deploymentとexecutionのためにgas payerにも資金が必要です。

外部ECDSA ownerをdappが要求した場合、Paliは明示的に警告します。そのアドレスは将来のアカウント操作を承認できるためです。

## Dappメソッド

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

## 対応ネットワーク

Paliスマートアカウントは、Paliが参照するアドレスにPali factoryとmodulesが存在する互換EVMチェーンで利用できます。これはPaliが運用するチェーンに限定されません。アクティブなチェーンがcanonical CREATE2 deployerを提供している場合、Paliは不足しているスマートアカウント設定をウォレット内でデプロイできます。Pali Settingsを開き、Advancedに移動し、**Smart account setup** のDeployボタンを使ってください。

Passkey validatorにはP-256 WebAuthn検証が必要です。多くの新しいEVM環境ではP-256/passkey precompileで提供されていますが、本番利用前にチェーン側のサポートを確認してください。

## ユーザーによるコントロール

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>ウォレットでの確認後、選択したvalidatorがpasskeyベースの場合は、ブラウザまたはOSがWebAuthn passkeyの作成を処理します。</figcaption>
</figure>

ユーザーは承認前に、リクエスト元のサイト、アカウントのラベル、要求されたauthenticator、外部ECDSA ownerアドレスを確認できます。Paliが新しいpasskey credentialを必要とする場合は、ブラウザまたはOSがWebAuthnプロンプトを表示します。スマートアカウントがdappに接続される前に、Paliはデプロイ、モジュールのインストール、確認の進行状況を表示します。

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-dapp-onboarding-video.png" src="/video/smart-account-dapp-onboarding.mp4" title="Smart-account dapp onboarding flow"></video>
  <figcaption>Dapp起点のオンボーディング: リクエストを確認して承認すると、スマートアカウントが利用可能になります。</figcaption>
</figure>

## 標準仕様の参考

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
