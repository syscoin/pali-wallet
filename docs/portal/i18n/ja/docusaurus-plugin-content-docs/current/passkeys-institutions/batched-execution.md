---
title: バッチ実行
---

Paliスマートアカウントは `wallet_sendCalls` によるbatch executionをサポートします。ユーザーは複数のcallsを確認し、1つのaccount actionとして承認します。`atomicRequired` がtrueの場合、Paliは選択されたcallsを1つのsmart-account executionとして準備します。targetが空のcontract deployment callはこのflowではサポートされません。
