---
title: スマートアカウントとpasskeys
---

Paliスマートアカウントはモジュールで制御されるEVM contract accountです。Passkeyはサポートされる制御方法の1つで、ECDSAやcomposite policyも利用できます。

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>ユーザーは設定画面またはdappのリクエストからモジュール式スマートアカウントを作成し、承認を制御するvalidatorを選択できます。</figcaption>
</figure>

validatorは「このアカウントのアクションを誰が承認できるか？」への答えだと考えてください。重要なのは、アカウントを変えずにその答えを変更できることです。

- **自分のサインインのどれか1つ**（1-of-N）: 手元にあるpasskeyやキーのどれでも承認できます。
- **数人で一緒に**（t-of-N）: 人またはデバイスの定足数による合意が必要で、共有資金に最適です。
- **全員で一緒に**（N-of-N）: 設定されたすべてのサインインの承認が必要で、最も機密性の高いアカウント向けです。

policyは他のpolicyを含むこともできるため、チームは「リーダーのキーに加えて、デスクのpasskeyのうち任意の2つ」のような構成を表現できます。policyを変更しても、アドレス、残高、履歴はまったく変わりません。さらに署名はモジュール式なので、（ポスト量子を含む）将来の署名タイプも、同じアカウントで後から採用できます。

guardianは意図的にこのリストに**含まれていません**。guardianはトランザクションを決して承認できず、その唯一の権限は、ユーザーがアクセスを失ったときに、時間のかかる可視のrecoveryを開始することだけです。この分離により、誰かに日常的なコントロールを渡すことなく、アクセス喪失から守られます。

Passkey承認、チームowner、batch action、guardian recoveryに役立ちます。Paliはfactoryでdeterministicにdeployし、永続メタデータを保存します。Guardian recoveryは即時ではありません。guardianがintentに署名し、モジュールがdelay付きでscheduleし、その後validatorを置き換えられます。

オンチェーンでは、guardianは通常の鍵に限定されません。guardianの承認はECDSAまたはERC-1271で検証されるため、guardianはデプロイ済みのコントラクトアカウントでも構いません。たとえば、composite・カスタム・ポスト量子validatorをpolicyに持つ別のスマートアカウントもguardianにできます。その場合、recovery経路はそのguardianの署名方式を継承します。現在のPaliのguardian画面は鍵ベースの承認を収集しますが、デプロイ済みモジュールが既に対応しているため、コントラクトアカウントguardianのフローは後から追加できます。

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>スマートアカウントのpolicy画面には、インストール済みモジュール、アクティブvalidatorの詳細、guardian recovery、モジュール管理が表示されます。</figcaption>
</figure>
