---
title: インストールと接続
---

Paliをブラウザ拡張機能としてインストールし、ロックを解除してdappを開きます。Paliはトップレベルページにプロバイダーを注入するため、アプリケーションはアカウントや操作をリクエストできます。

## Paliを検出する

EVM連携では、利用可能な場合はEIP-6963を使用してください。複数の拡張機能がプロバイダーを注入している場合でも、ユーザーとdappsがPaliを他のウォレットと区別できます。

```js
const providers = [];

window.addEventListener('eip6963:announceProvider', (event) => {
  providers.push(event.detail);
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

const pali = providers.find(({ info }) => {
  const name = info.name.toLowerCase();
  const rdns = info.rdns.toLowerCase();
  return name.includes('pali') || rdns.includes('pali');
});
```

UTXOおよびSyscoinフローでは、`window.pali`を確認してください。

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## EVMアカウントを接続する

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="Pali dapp connection popup showing the requesting site and account selection" />
</a>
  <figcaption>Paliはdappアクセスを許可する前に、リクエスト元サイトとアカウントを表示します。</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXOアカウントを接続する

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## 拒否とネットワーク不一致を処理する

ユーザーは接続リクエストを拒否できます。ウォレットがEVMモードのときに`sys_requestAccounts`を呼び出すなど、アクティブネットワークが誤ったチェーンファミリーである場合にも、Paliはメソッドを拒否できます。

```js
try {
  await window.pali.request({ method: 'sys_requestAccounts', params: [] });
} catch (error) {
  if (error.code === 4001) {
    console.log('The user rejected the request.');
  } else {
    console.error('Pali request failed', error);
  }
}
```

## ローカル開発ビルドを読み込む

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="Pali Wallet installed and unlocked in a clean browser profile" />
</a>
  <figcaption>インストールとロック解除のフローを記録するときは、クリーンなテストプロファイルを使用してください。</figcaption>
</figure>

ウォレットリポジトリから:

```bash
yarn install
yarn dev:chrome
```

その後、`chrome://extensions`を開き、Developer Modeを有効にして、Load unpackedを選択し、生成された`build/chrome`ディレクトリを選択します。
