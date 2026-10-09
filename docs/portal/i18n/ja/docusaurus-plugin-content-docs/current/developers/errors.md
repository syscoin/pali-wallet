---
title: エラー
---

プロバイダーへのリクエストは、必ず`try` / `catch`で囲んでください。Paliは可能な限り標準のJSON-RPCおよびEIP-1193形式のエラーを使い、未対応ネットワーク、ハードウェアウォレットの制約、パスキーの状態にはウォレット固有のエラーも使用します。

```js
try {
  await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx],
  });
} catch (error) {
  switch (error.code) {
    case 4001:
      console.log('User rejected the request.');
      break;
    case 4100:
      console.log('The dapp is not authorized.');
      break;
    case 4200:
      console.log('The method is unsupported.');
      break;
    default:
      console.error(error);
  }
}
```

## 主な分類

| コード | 意味 |
| --- | --- |
| `4001` | ユーザーがリクエストを拒否しました。 |
| `4100` | アカウントまたはメソッドが許可されていません。 |
| `4101` | このメソッドは別のチェーン種別でのみ利用できます。 |
| `4200` | 未対応のメソッドです。 |
| `4900` | プロバイダーが切断されています。 |
| `4901` | プロバイダーが要求されたチェーンから切断されています。 |
| `5710` | EIP-5792バンドルのチェーン用RPCがウォレットに設定されていません（`wallet_getCallsStatus` / `wallet_showCallsStatus`）。 |
| `5720` | `wallet_sendCalls`で、dappが指定したEIP-5792バンドルidが重複しています。 |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus`で、EIP-5792バンドルidが見つかりません。 |

詳しい一覧は[エラーコード](../reference/error-codes.md)を参照してください。

## 中断されたリクエストの再試行

タイムアウト、承認ウィンドウの終了、接続切断が発生しても、トランザクションが一度も送信されていないとは限りません。再度の署名や送信を要求する前に、判明しているトランザクションハッシュ、取引履歴、バンドル状態を確認してください。ブロードキャストが確認済みなら、その後ローカルの履歴更新に失敗しても成功した状態のままです。

通常の読み取りは必要に応じて再試行できますが、結果が不明な状態で、署名、ウォレット作成、ブロードキャストのリクエストを自動再送しないでください。アカウントやネットワークが変わった場合、現在のコンテキストで新たな承認を得てください。スマートアカウントの設定が保留中の場合は、再デプロイを試す前に、元のネットワークでその状態を確認してください。
