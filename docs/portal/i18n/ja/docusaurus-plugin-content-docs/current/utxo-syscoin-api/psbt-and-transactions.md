---
title: PSBTとトランザクション
---

UTXOアプリケーションは、トランザクションを慎重に構築し、Paliを通じて署名を要求し、ユーザーの承認後にだけブロードキャストしてください。

## PSBTに署名する

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">PSBT署名の確認</p>
      <p className="pali-capture-card__subtitle">UTXO署名の確認</p>
      <p className="pali-capture-card__hint">プレビュー内をスクロールして、出力、入力、サイズ、ウェイト、ロックタイムを確認してください。</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="PaliのPSBT署名確認画面" />
    </div>
  </div>
  <figcaption>PaliはUTXO PSBTに署名する前に、ユーザーへ確認を求めます。</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## 署名して送信する

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## トランザクションを取得する

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## アドレスを検証する

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## dappの責任

Paliはユーザーが承認した内容に署名します。署名を要求する前に、適切なPSBTの入力、出力、手数料、釣銭、アセットメタデータを構築する責任は、アプリケーション側にあります。

## アカウント選択

署名は、要求元のdappに接続されたアカウントと、承認済みのネットワークに結び付けられます。PSBTメタデータで別のウォレットアカウントを選ぶことはできません。Paliが別のアカウントを表示している場合、承認前に接続済みアカウントへ切り替えるようユーザーに求めることがあります。別のアカウントを使うには、dappの接続先を変更して、新たに承認を要求してください。

未完了の入力を含むPSBTでは、少なくとも1つの未完了の入力が承認済みアカウントに属している必要があります。Paliはそのアカウントの入力だけに署名します。そのため、共有トランザクションやマルチシグのトランザクションは部分署名の状態で返る場合があり、他の参加者は自身の入力や署名を完成させる必要があります。既存の外部署名と、対応しているファイナライズ済み入力は保持されます。完全にファイナライズ済みのPSBTは、署名を追加せずに返すことができます。ハードウェアウォレットの対応範囲は、引き続きデバイスとトランザクション形式によって異なります。

アカウントやネットワークが変わると、保留中の署名コンテキストは無効になります。古いリクエストを再送するのではなく、リクエストを再構築または再確認し、新たな承認を得てください。
