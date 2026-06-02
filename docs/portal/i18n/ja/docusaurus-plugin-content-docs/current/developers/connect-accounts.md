---
title: アカウント接続
---

Paliの接続リクエストは、明示的なユーザー承認です。dappsは、ユーザーが接続ボタンをクリックしたときだけアクセスをリクエストする必要があります。

## EVM接続

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXO接続

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## 接続状態を読み取る

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## dappごとに1つのアクティブアカウント

Paliは多くのdapp originsを接続済みにできます。単一のoriginについて、Paliは1つのアクティブな接続済みアカウントを追跡します。重要なリクエストが異なる`from`アドレスを参照する場合、Paliはユーザーにdapp接続の切り替えを求めることがあります。

## 切断

EVM権限では、`wallet_revokePermissions`がdappをPaliから切断します。

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
