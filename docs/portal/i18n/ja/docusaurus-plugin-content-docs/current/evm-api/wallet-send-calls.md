---
title: wallet_sendCalls
---

PaliはEVMバッチ要求向けにEIP-5792形式の`wallet_sendCalls`をサポートします。対応するPaliスマートアカウントは複数の呼び出しを1回のアカウント実行として認可できます。

## capabilitiesを確認する

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Paliは対応するPaliスマートアカウントについてアトミック対応を、通常のEOAについてアトミック実行非対応を報告します。

## バッチを送信する

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## スマートアカウントの動作

ユーザーは要求されたバッチ全体を承認または拒否します。個々の呼び出しを選択解除することはできません。Paliスマートアカウントでは、Paliはバッチ全体を1回のアカウント実行として準備し、アクティブなバリデーターの認可を求め、宛先をウォレットのブロックリストと照合して1件のトランザクションを送信します。PasskeyバリデーターはWebAuthn assertionを使用し、設定済みのローカルECDSA所有者はアクションハッシュに署名します。

## EOAでの動作

通常のEVMアカウントでは、Paliは要求されたバッチ全体を承認または拒否するよう表示し、呼び出しを順次送信します。これはオンチェーンのアトミック実行ではありません。アトミック実行が必要な場合は、対応するPaliスマートアカウントまたはアトミックなバッチ処理用コントラクトを使用してください。

## ステータスメソッド

`wallet_getCallsStatus`と`wallet_showCallsStatus`はEIP-5792に準拠して実装されています。`wallet_getCallsStatus`はオンチェーンreceipts付きの標準ステータスオブジェクト（`100` 保留中、`200` 確認済み、`500` リバート、`600` 部分的リバート）を返します。`wallet_showCallsStatus`は同じ情報を表示する読み取り専用のPaliポップアップを開きます。`wallet_sendCalls`でdappが指定した`id`は尊重され、そのまま返されます。不明なbundle idはエラー`5730`で、dapp指定idの重複は`5720`で失敗します。
