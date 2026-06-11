---
title: エラー
---

プロバイダーリクエストは必ず`try` / `catch`で囲んでください。Paliは可能な限り標準のJSON-RPCおよびEIP-1193スタイルのエラーを使用し、未サポートネットワーク、ハードウェアウォレット制約、passkey状態にはウォレット固有のエラーも使用します。

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

## 一般的なカテゴリ

| コード | 意味 |
| --- | --- |
| `4001` | ユーザーがリクエストを拒否しました。 |
| `4100` | 未承認のアカウントまたはメソッドです。 |
| `4101` | メソッドは別のチェーンファミリーでのみ利用できます。 |
| `4200` | 未サポートのメソッドです。 |
| `4900` | プロバイダーが切断されています。 |
| `4901` | プロバイダーが要求されたチェーンから切断されています。 |
| `5720` | `wallet_sendCalls`でdappが指定したEIP-5792 bundle idの重複です。 |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus`の不明なEIP-5792 bundle idです。 |

より長いリファレンスは[Error codes](../reference/error-codes.md)を参照してください。
