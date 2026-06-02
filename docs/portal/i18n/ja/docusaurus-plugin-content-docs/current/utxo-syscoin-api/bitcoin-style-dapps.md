---
title: Bitcoinスタイルのdapps
---

PaliのUTXOプロバイダーにより、Syscoin UTXOや互換性のあるトランザクションモデルを含むBitcoinスタイルのアカウントフローを、ブラウザdappsで実現できます。

## EVMとの違い

EVM dappsは通常、1つのアカウントにトランザクションオブジェクトへの署名を求めます。UTXO dappsは通常、次を行います。

1. アカウントとUTXO状態を読み取ります。
2. PSBTを構築します。
3. 変更アドレスを含めます。
4. ウォレットに署名を求めます。
5. finalizeしてブロードキャストします。

## 最小の連携形

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## ベストプラクティス

- PSBTを決定論的に構築し、アプリ内でユーザーにトランザクション概要を表示してください。
- 受取アドレスを再利用せず、Paliの変更アドレスを使用してください。
- testnet/mainnetの違いを処理してください。
- ウォレットロック、拒否、ネットワーク不一致エラーを処理してください。
- ユーザーが意味のある操作を開始するまで、xpubや署名をリクエストしないでください。
