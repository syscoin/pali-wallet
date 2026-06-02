---
title: wallet_sendCalls
---

PaliはEVMバッチリクエスト向けにEIP-5792スタイルの`wallet_sendCalls`をサポートします。これは、複数の呼び出しを1つのWebAuthn assertionで承認できるpasskeyスマートアカウントにとって特に重要です。

## capabilitiesを確認する

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Paliはpasskeyスマートアカウントではアトミックサポートを報告し、通常のEOAではアトミック実行を未サポートとして報告します。

## バッチを送信する

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
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

## Passkeyでの動作

Passkeyスマートアカウントの場合、Paliは選択されたすべての呼び出しを1つのスマートアカウント実行バッチとして準備し、1つのpasskey assertionをリクエストし、1つのトランザクションを送信します。アカウントが未デプロイの場合、デプロイと任意の初期policy実行を最初のトランザクション経路に含められます。

## EOAでの動作

通常のEVMアカウントの場合、Paliは呼び出しを提示し、選択された呼び出しを順次送信します。これはオンチェーンのアトミック性と同じではありません。dappが真のアトミック実行を必要とする場合は、passkeyスマートアカウントまたは呼び出しをアトミックにバッチ処理するよう設計されたコントラクトを使用してください。

## ステータスメソッド

`wallet_getCallsStatus`と`wallet_showCallsStatus`は互換性のために存在しますが、永続的なbundle statusは実装されていません。即時の`wallet_sendCalls`結果とトランザクションハッシュを有用な出力として扱ってください。
