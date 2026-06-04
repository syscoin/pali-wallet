---
title: Passkeysと機関
---

Pali passkeyスマートアカウントにより、dappはウォレットにオンチェーンアカウント作成をリクエストでき、ユーザーはWebAuthnを通じて実行を制御できます。

これは次に役立ちます。

- 機関向けオンボーディング
- スポンサーが支えるgasフロー
- 共同承認policy
- ウォレット再インストール後のアカウント復元
- アトミックな複数呼び出しワークフロー
- ウォレットを構築せずにpasskey UXを提供したいdapps

## zkSYS passkeysが可能な理由

PasskeysはWebAuthnを使用し、WebAuthnの標準署名アルゴリズムはES256、つまりsecp256r1としても知られるP-256曲線上のECDSAです。一般的なEVMウォレットは通常secp256k1 EOAを使用するため、passkey署名は直接EOA署名にはなりません。

Paliのpasskeyアカウントは、オンチェーンP-256検証を中心に設計されたzkSYSスマートアカウントです。ウォレットはWebAuthn公開鍵座標、challenge、authenticator data、client data、P-256署名を抽出し、スマートアカウント/ファクトリー経路がそのproofをアカウントの登録済みメタデータに対して検証します。これにより、秘密鍵をユーザーの認証器内に保持したまま、デバイスの生体認証やプラットフォームpasskeysをアカウント承認に使用できます。

実用上の結果として、生体認証ログインのように感じられるウォレットUXでありながら、チェーン上の操作を承認できます。

1. dappがpasskeyスマートアカウントまたはバッチ実行をリクエストします。
2. Paliが正確なチェーン、アカウント、呼び出し、nonce、deadline、スポンサーpolicyに対するアクションハッシュを準備します。
3. ブラウザ/OSがユーザーにpasskey承認を求めます。
4. zkSYSスマートアカウントが実行前にP-256 WebAuthn proofをオンチェーンで検証します。

## サポートされるネットワーク

PasskeyアカウントはすべてのEVMチェーンで有効ではありません。設定済みpasskeyファクトリーとzkSYS P-256検証サポートが必要です。

| ネットワーク | Chain id | このPaliビルドでの状態 |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | 設定済み。Factory: `0xab188ceB49096A8B96E69E357FC99A8F90A57431`。 |
| `zkSYS` | TBD in wallet config | Paliにファクトリーアドレスが設定された後、同じpasskeyアーキテクチャの本番ターゲットとして意図されています。 |

設定済みファクトリーがないネットワークでdappが`wallet_createPasskeyAccount`を呼び出した場合、Paliは未サポートのメタデータを作成する代わりにリクエストを拒否します。

## dappメソッド

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="Pali wallet_createPasskeyAccount popup with sponsorship disabled" />
</a>
  <figcaption>デフォルトのdapp主導passkeyフローは、機関が明示的にスポンサーpolicyを必要としない限り、スポンサーシップ無効から始めるべきです。</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

結果にはスマートアカウントの`address`と公開passkeyメタデータが含まれます。

## スポンサーmodes

| Mode | 意味 |
| --- | --- |
| `disabled` | スポンサーpolicyはありません。ウォレット/ユーザーがgasを支払います。 |
| `gasOnly` | スポンサーサービスがgasを支払う場合があります。スポンサーシップが失敗した場合、wallet-gas fallbackを許可できます。 |
| `required` | policyによりスポンサーの共同承認が必須です。 |

## ユーザー制御

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>ウォレットでの確認後、ブラウザまたはオペレーティングシステムがWebAuthn passkey作成を処理します。</figcaption>
</figure>

ユーザーは承認前に、リクエスト元サイト、label、スポンサーmode、signer、URL、policy textを確認します。その後、ブラウザまたはOSがWebAuthn passkeyプロンプトを表示します。

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey dapp onboarding flow"></video>
  <figcaption>Passkeyオンボーディングフロー: ブランド付きイントロ、dappリクエスト、Paliアカウント承認。</figcaption>
</figure>
