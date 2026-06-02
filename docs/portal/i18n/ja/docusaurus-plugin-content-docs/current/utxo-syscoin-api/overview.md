---
title: UTXOとSyscoin API概要
---

Paliは`window.pali`を通じてUTXOおよびSyscoinの機能を公開します。

アプリが次を必要とする場合、このプロバイダーを使用してください。

- Syscoin UTXOアカウントアクセス。
- PSBT署名。
- トランザクションブロードキャスト。
- 変更アドレス。
- 接続済みアカウントのxpub。
- UTXOトランザクション履歴。
- Syscoin Platform Tokenアセットメタデータと保有状況。

## 接続

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Pali UTXO connection popup for a Syscoin dapp" />
</a>
  <figcaption>UTXO dappsは<code>window.ethereum</code>ではなく<code>window.pali</code>を通じて接続します。</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## プロバイダーユーティリティ

`window.pali`には、リクエストベースのRPCメソッドと、一般的なSyscoinアセット読み取り用の`_sys`ヘルパーメソッドが含まれます。

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## チェーンファミリールール

UTXOメソッドでは、ウォレットが互換性のあるUTXO/Syscoinネットワークコンテキストにある必要があります。アプリがEVMもサポートする場合、プロバイダー呼び出しを分離し、モード切り替えを明示的に処理してください。
