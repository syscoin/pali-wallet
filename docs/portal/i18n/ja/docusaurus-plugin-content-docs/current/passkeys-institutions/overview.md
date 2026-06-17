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

- **Validator**は署名権限です。validatorは、ある承認（passkey証明、ECDSA署名、composite policyの結果）がアカウントのアクションを認可するかどうかを判断します。トランザクションを承認できるのはvalidatorだけです。
- **Executor**は署名ではないアカウント機能を追加します。Paliのguardian recoveryモジュールはexecutorです。guardianは署名も資金移動もできず、active validatorのtimelock付き置き換えをスケジュールすることしかできません。

この役割分離こそが、recoveryを安心して推奨できる理由です。guardianが侵害されても、攻撃者に署名権限は渡りません。攻撃者が得られるのは、遅延付きで、可視で、キャンセル可能なrecovery試行だけです。

## Composite署名policy

composite validatorは子validatorをthresholdの下で組み合わせ、1つのアカウントをpolicyエンジンに変えます。

- **1-of-N** — 複数のauthenticatorのうちどれか1つで承認できます。各デバイスにpasskeyを置く個人アカウントに便利です。
- **t-of-N** — 定足数の承認が必要です。共有トレジャリー、デスク、チーム管理アカウントに自然な形です。
- **N-of-N** — 設定されたすべてのvalidatorの承認が必要です。最大限の保証が必要なアカウント向けです。

compositeはネストできます。compositeの子はそれ自体がcompositeになれるため、たとえば「CFOのキー AND（3つのデスクpasskeyのうち任意の2つ）」のような階層的policyを、カスタムコントラクトなしで表現できます。guardian recoveryは、どのvalidator policyがアクティブであっても独立したままです。

## Validatorの俊敏性とポスト量子への備え

認可が置き換え可能なモジュール内にあるため、アカウントは特定の署名方式に縛られません。現在Paliが提供するのは、ECDSA（ウォレット所有のデフォルト）、P-256 WebAuthn passkey、composite validatorです。ポスト量子署名方式を含む新しいvalidatorタイプがデプロイされると、それらは同じアドレスの同じアカウントにインストールされます。その時点で、トランザクションごとの認可をECDSAを一切介さずに実行できるようになります。資金、履歴、連携が移動することはなく、進化するのは署名権限だけです。

同じ俊敏性はrecoveryにも及びます。guardian recoveryモジュールは標準的な署名検証で承認を確認します。通常のアドレスには素のECDSA、コントラクトアカウントにはERC-1271を使うため、guardian自体を、composite・カスタム・ポスト量子validatorで管理されるスマートアカウントにすることもできます。デプロイ済みのコントラクトアカウントguardianを使うと、recovery経路はそのアカウントの署名方式を継承します。これにより、署名と**recoveryの両方**を最終的に従来型ECDSAへの依存なしで運用できます。現在のPaliのguardian UXは鍵ベースの承認を収集しますが、オンチェーンのモジュールは既に対応しているため、コントラクトアカウントguardianのフローは後からウォレットに追加できます。

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
