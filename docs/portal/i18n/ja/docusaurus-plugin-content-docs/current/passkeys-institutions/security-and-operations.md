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

composite validatorは子validatorをthreshold（1-of-N、t-of-N、N-of-N）の下で組み合わせられ、子自体もcompositeにできるため、階層的なpolicyを構成できます。

composite policyを設計するときは、thresholdの根拠を文書化してください。1-of-Nは可用性を、N-of-Nは保証を最適化し、t-of-Nは両者のバランスを取ります。validatorは置き換え可能なモジュールであるため、policy（さらには将来のポスト量子validatorを含む署名方式そのもの）を、アカウントアドレスを変えずに後からアップグレードできます。guardianはexecutorロールのモジュールであり、どのvalidator policyがアクティブであっても独立したままです。

Guardian recoveryは遅延付きvalidator置換です。Paliは各試行で新しいsaltを使い、モジュールはアカウントごとに1つのactive recoveryのみ許可します。
