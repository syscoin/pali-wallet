---
title: passkeyアカウントの作成と復元
---

`wallet_createPasskeyAccount`は、dappオンボーディング用の新しいpasskeyスマートアカウントを作成します。PaliはWebAuthn credentialを作成または選択し、スマートアカウントをオンチェーンでデプロイし、デプロイ済みの復元メタデータを確認してから、確認後にアカウントをローカルウォレット状態へ書き込みます。

ローカルウォレット状態は、デプロイ済みのpasskeyアカウントを表します。すでにオンチェーンに存在するアカウントは、Pali設定から復元できます。

## スマートアカウントとファクトリー構造

passkeyシステムには2つのオンチェーン要素があります。

- **Factory:** アカウントを作成し、counterfactualアドレスを計算し、復元lookupを公開し、最初の操作のデプロイと実行をまとめて行えます。
- **Smart account:** 復元メタデータ、nonce、スポンサーpolicyを保存し、呼び出しを実行する前にWebAuthn/P-256 execution proofsを検証します。

ファクトリーアカウントパラメーターには次が含まれます。

| パラメーター | 意味 |
| --- | --- |
| `passkeyX`, `passkeyY` | WebAuthn credentialから抽出されるP-256公開鍵座標。 |
| `credentialIdHash` | WebAuthn credential idのハッシュ。 |
| `rpIdHash` | authenticator dataからのWebAuthn RP ID hash。 |
| `originHash`, `originLength` | WebAuthn client dataからのextension-origin binding data。 |
| `salt` | 1つのcredentialが複数のスマートアカウントを制御できるようにするデプロイsalt。 |

スマートアカウントは、実行、署名検証、nonce、スポンサーpolicy、復元メタデータの読み取りを公開します。Paliはそのメタデータを使用して、ローカル状態喪失後にアカウントを再構築します。

## スポンサーシップ無効で作成する

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## スポンサーpolicy付きで作成する

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="Pali passkey account creation popup with required sponsor policy details" />
</a>
  <figcaption>必須スポンサーシップでは、ユーザーが承認する前にsponsor URL、signer、policy textが表示されます。</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## 作成とデプロイの動作

dappがpasskeyアカウントをリクエストすると:

1. Paliはアクティブチェーンがpasskeyスマートアカウントをサポートすることを検証します。
2. Paliは新しいアカウント経路のために新しいデプロイsaltを作成します。
3. PaliはWebAuthn credential profileを取得または作成します。
4. Paliはcounterfactualアドレスとデプロイメタデータを計算します。
5. Paliはデプロイ承認hashに対するpasskey assertionをユーザーに求めます。
6. Paliは設定されたデプロイgas payerを通じて`createAccount`を送信します。初期スポンサーpolicyアクションが必要な場合は`createAccountAndExecute`を送信します。
7. Paliは確認を待ち、スマートアカウントの復元メタデータをチェーンから読み取り、準備済みcredentialとorigin dataに一致することを検証します。
8. 確認後、Paliはローカルpasskeyアカウントを作成し、要求元dappへ接続します。

結果のアドレスがデプロイ済みpasskeyアカウントとしてローカルに存在する場合、Paliはそのローカルアカウントを再利用できます。

## 何がアドレスを決定するのか

スマートアカウントアドレスは、passkey公開座標、credential hash、origin data、RP ID hash、deployment saltを含むファクトリー入力から派生します。新しいアカウント経路ごとに新しいdeployment saltを使用するため、1つのcredentialで複数のスマートアカウントを制御できます。

## ユーザーがローカルPaliデータを失った場合

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Pali settings screen for recovering passkey smart accounts" />
</a>
  <figcaption>復元画面は、復元済みウォレットと認証器に一致するオンチェーンpasskeyアカウントを検出します。</figcaption>
</figure>

ブラウザプロファイル、拡張機能ストレージ、またはローカルpasskeyアカウントメタデータが失われても、チェーンにはアカウント復元に十分な公開メタデータが残っている場合があります。

1. Paliはユーザーの認証器からdiscoverable WebAuthn assertionをリクエストします。
2. Paliはcredential hashでファクトリーレジストリを照会します。
3. Paliは各候補アカウントの復元メタデータを読み取ります。
4. Paliはローカルにすでに存在するアカウントをスキップします。
5. Paliは一致するアカウントをローカルウォレット状態へインポートします。

設定からの復元はデプロイ済みアカウントを検出し、registryがcredentialに対して公開する一致アカウントをすべてインポートします。

## RP IDとcredential名

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>復元と実行には、関連するpasskey credentialからのWebAuthn assertionが必要です。</figcaption>
</figure>

ウォレット経路によってRP IDが提供されない限り、ブラウザはextension-origin WebAuthnの実効RP IDを制御します。Paliはデフォルトの共有credentialに`Pali Wallet Passkey`というラベルを付け、ユーザーに表示されるアカウント関連付けには要求されたアカウントlabelを使用します。
