---
title: EVMモードとUTXOモード
---

PaliはアカウントベースのEVMネットワークとUTXOベースのネットワークをサポートします。アカウントモデルが根本的に異なるため、拡張機能は別々のプロバイダーサーフェスを使用します。

## EVMモード

EVMモードは`window.ethereum`を使用するdapps向けです。MetaMaskスタイルのアカウントリクエスト、トランザクション、署名、権限、トークン監視リクエスト、ネットワーク管理をサポートします。

例:

- RolluxおよびSyscoin NEVM dapps
- ERC-20、ERC-721、ERC-1155の操作
- EIP-712 typed data署名
- passkeyスマートアカウントの作成と実行

## UTXOモード

UTXOモードは`window.pali`を使用するdapps向けです。Syscoin UTXOアカウント状態、xpubを考慮した連携、PSBT署名、トランザクションブロードキャスト、SPTアセットフローをサポートします。

例:

- Syscoin UTXOアセットアプリケーション
- Bitcoin風のPSBTワークフロー
- 変更アドレスを必要とするdapps
- UTXOトランザクション履歴を読み取るdapps

## モード切り替え

dappが誤ったチェーンファミリー向けのメソッドをリクエストした場合、Paliはネットワーク切り替えを要求することがあります。dappsはこれらのエラーを適切に処理し、ユーザーを正しいネットワークへ案内する必要があります。

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

UTXOコンテキストとEVMコンテキストを切り替えると、アクティブなアカウントファミリーが変わるため、dappの再接続が必要になる場合があります。
