---
title: アセット、SPT、NFTヘルパー
---

PaliはUTXOプロバイダーと`_sys`ヘルパーAPIを通じてSyscoinアセットヘルパーを公開します。

## ウォレットトークンを取得する

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Syscoinアセットメタデータを取得する

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## `_sys`ヘルパーを使用する

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## NFTチェック

`_sys.isNFT(guid)`ヘルパーは、注入されたプロバイダーユーティリティレイヤーで利用できます。リクエストメソッド`sys_isNFT`はウォレットメソッドカタログに登録されていますが、本番で依存する前に現在の実装カバレッジを検証する必要があります。

## アセットUXガイダンス

ユーザーにUTXOアセットトランザクションへの署名を求める前に、アセット名、シンボル、数量、GUIDを明確に表示してください。UTXOアセットフローはERCトークンフローほど標準化されていないため、dappsはウォレットUIがすべての詳細を推測できると仮定すべきではありません。
