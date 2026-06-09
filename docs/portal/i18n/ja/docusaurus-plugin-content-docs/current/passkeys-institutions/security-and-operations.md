---
title: セキュリティと運用
---

Paliスマートアカウントはアカウント基盤として扱う必要があります。コントラクトが資産を保持し、インストール済みモジュールが誰に移動権限があるかを決めます。

## チェックリスト

- アカウントを制御するvalidatorを決める: passkey、ECDSA、composite、またはrecovery。
- 外部ECDSA ownersは高リスクとして扱う。
- guardians、threshold、recovery delayを定義する。
- gas payerに資金を入れておく。
- failed deployment、failed module install、expired recoveryを監視する。

Guardian recoveryは遅延付きvalidator置換です。Paliは各試行で新しいsaltを使い、モジュールはアカウントごとに1つのactive recoveryのみ許可します。
