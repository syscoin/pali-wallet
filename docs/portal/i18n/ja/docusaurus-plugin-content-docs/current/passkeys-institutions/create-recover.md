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

復元はインストール済みモジュールに依存します。deterministic accountはwallet anchor、chain、index、factoryから再構築できます。Passkey validatorには対応するWebAuthn credentialが必要です。Guardian recoveryは設定されたdelay後にactive validatorを置き換えられます。
