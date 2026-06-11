---
title: エラーコード
---

PaliはJSON-RPC、EIP-1193、EIP-1474、ウォレット固有のエラーを使用します。dappsは常に`error.code`と`error.message`の両方を確認する必要があります。

## 標準JSON-RPC

| コード | 意味 |
| --- | --- |
| `-32700` | Parse error。 |
| `-32600` | Invalid request。 |
| `-32601` | Method not foundまたは利用不可。 |
| `-32602` | Invalid params。 |
| `-32603` | Internal error。 |

## Ethereumプロバイダーエラー

| コード | 意味 |
| --- | --- |
| `4001` | ユーザーがリクエストを拒否しました。 |
| `4100` | 未承認のアカウントまたはメソッドです。 |
| `4200` | 未サポートのメソッドです。 |
| `4900` | プロバイダーが切断されています。 |
| `4901` | プロバイダーが指定されたチェーンから切断されています。 |

## EIP-1474スタイルのエラー

| コード | 意味 |
| --- | --- |
| `-32000` | Invalid input。 |
| `-32001` | Resource not found。 |
| `-32002` | Resource unavailable。 |
| `-32003` | Transaction rejected。 |
| `-32004` | Method not supported。 |
| `-32005` | Request limit exceeded。 |

## Pali固有の一般的なエラー

| コード | 意味 |
| --- | --- |
| `4101` | メソッドはEVM-onlyまたはUTXO-onlyなど、別のチェーンファミリーでのみ利用できます。 |
| `4874` | メソッドはハードウェアウォレットをサポートしていません。 |
| `5710` | bundleのチェーンに対するRPCがウォレットに設定されていません（`wallet_getCallsStatus` / `wallet_showCallsStatus`）。 |
| `5720` | `wallet_sendCalls`でdappが指定したbundle idの重複です。 |
| `5730` | `wallet_getCallsStatus` / `wallet_showCallsStatus`の不明なbundle idです。 |

## ベストプラクティス

- `4001`は通常のユーザーキャンセルとして扱ってください。
- `4101`は、ユーザーを正しいネットワークファミリーへ案内するきっかけとして扱ってください。
- ブロッキングリクエストを短いループで再試行しないでください。Paliはポップアップspamからユーザーを保護します。
- passkeyスポンサー失敗、特に必須スポンサーmodeについては、実行可能な文言を表示してください。
