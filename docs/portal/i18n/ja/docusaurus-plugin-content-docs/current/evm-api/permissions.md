---
title: 権限
---

PaliはEVM dapps向けにEIP-2255スタイルの権限をサポートします。

## 権限をリクエストする

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

ほとんどのdappsは代わりに`eth_requestAccounts`を使用できます。明示的な権限オブジェクトと許可済みチェーンメタデータが必要な場合に`wallet_requestPermissions`を使用してください。

## 権限を取得する

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## 権限を取り消す

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

Paliでは、取り消しによってdappがウォレットから切断されます。これを細かい部分的な権限編集ではなく、サイト全体の切断として扱ってください。

## アカウント切り替え

トランザクション送信や署名などのブロッキングメソッドでは、Paliは接続済みdappアカウントがdappから要求されたアカウントと一致することを確認します。dappがアクティブな接続済みアカウントではない`from`アドレスを送信した場合、Paliはユーザーにdapp接続の切り替えを求めることがあります。
