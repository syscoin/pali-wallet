---
title: passkeyアカウントの作成と復元
---

`wallet_createPasskeyAccount`は、dappオンボーディングのために意図的に冪等です。Paliは新しいcredential/account経路を作成する前に、復元可能なオンチェーンアカウントを確認します。

## スマートアカウントとファクトリー構造

passkeyシステムには2つのオンチェーン要素があります。

- **Factory:** アカウントを作成し、counterfactualアドレスを計算し、復元lookupを公開し、最初の操作のデプロイと実行をまとめて行えます。
- **Smart account:** 復元メタデータ、nonce、スポンサーpolicyを保存し、呼び出しを実行する前にWebAuthn/P-256 execution proofsを検証します。

ファクトリーアカウントパラメーターには次が含まれます。

| パラメーター | 意味 |
| --- | --- |
| `recoveryId` | Paliウォレットコンテキスト、chain id、factory addressから派生するウォレットスコープの復元アンカー。 |
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

## 作成前に復元する動作

dappがpasskeyアカウントをリクエストすると:

1. Paliはアクティブチェーンがpasskeyスマートアカウントをサポートすることを検証します。
2. Paliは、passkeyが要求されたスポンサーpolicyに一致するオンチェーンアカウントを復元できるか確認します。
3. 一致するアカウントがローカルに存在する場合、Paliはそれを再利用します。
4. 一致するアカウントがオンチェーンに存在するがローカルにない場合、Paliはそれをインポートします。
5. 同じsponsor URL hashのアカウントが存在するがmodeまたはsignerが異なる場合、Paliは復元不一致として拒否します。
6. 一致するアカウントが存在しない場合、Paliは新しいアカウント作成を進めます。

## 何がアドレスを決定するのか

スマートアカウントアドレスは、passkey公開座標、credential hash、origin data、RP ID hash、recovery ID、deployment saltを含むファクトリー入力から派生します。Sponsor URL text自体はアドレスseedではありませんが、スポンサーpolicyは機関スコープのオンボーディングにおける復元マッチングロジックで使用されます。

## ユーザーがローカルPaliデータを失った場合

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Pali settings screen for recovering passkey smart accounts" />
</a>
  <figcaption>復元画面は、復元済みウォレットと認証器に一致するオンチェーンpasskeyアカウントを検出します。</figcaption>
</figure>

ブラウザプロファイル、拡張機能ストレージ、またはローカルpasskeyアカウントメタデータが失われても、チェーンにはアカウント復元に十分な公開メタデータが残っている場合があります。

1. ユーザーはrecovery IDをアンカーするウォレットコンテキストでPaliを復元または開きます。
2. Paliはユーザーの認証器からdiscoverable WebAuthn assertionをリクエストします。
3. Paliはrecovery IDとcredential hashでファクトリーレジストリを照会します。
4. Paliは各候補アカウントの復元メタデータを読み取ります。
5. Paliはローカルにすでに存在するアカウントをスキップします。
6. Paliは一致するアカウントをローカルウォレット状態へインポートします。

dapp主導の作成/復元では、Paliは復元されたアカウントのスポンサーmode、signer、URL hashも、dappが要求したスポンサーpolicyと比較します。これにより、機関がdappの要求と異なるスポンサーpolicyへユーザーを静かに紐づけることを防ぎます。

## RP IDとcredential名

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>復元と実行には、関連するpasskey credentialからのWebAuthn assertionが必要です。</figcaption>
</figure>

ウォレット経路によってRP IDが提供されない限り、ブラウザはextension-origin WebAuthnの実効RP IDを制御します。Paliはデフォルトの共有credentialに`Pali Wallet Passkey`というラベルを付け、ユーザーに表示されるアカウント関連付けには要求されたアカウントlabelを使用します。
