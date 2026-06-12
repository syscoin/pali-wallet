---
title: スマートアカウントの作成と復元
---

`wallet_prepareSmartAccount` はdapp onboarding用にPaliスマートアカウントを作成します。Paliはアカウントを導出し、設定済みfactoryでdeployし、必要に応じて要求されたvalidatorをインストールし、dappに接続し、永続メタデータをローカルに保存します。

## 構造

- **Factory:** deterministic addressを計算し、アカウントをdeployします。
- **Smart account:** callsを実行し、installed validatorsに確認します。
- **Validators:** ECDSA、P-256 WebAuthn passkey、composite。
- **Executors:** 遅延付き復元のためのguardian recovery。

## Recovery

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali settings screen for recovering smart accounts" />
</a>
  <figcaption>リカバリー画面では、Paliが作成したアカウントの再構築、またはguardian recoveryによるアクティブvalidatorの置き換えにより、スマートアカウントへのアクセスを復元できます。</figcaption>
</figure>

復元はインストール済みモジュールに依存します。deterministic accountはwallet anchor、chain、index、factoryから再構築できます。Passkey validatorには対応するWebAuthn credentialが必要です。Guardian recoveryは設定されたdelay後にactive validatorを置き換えられます。

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>リカバリーと実行には、該当するpasskey credentialによるWebAuthnアサーションが必要です。</figcaption>
</figure>
