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
