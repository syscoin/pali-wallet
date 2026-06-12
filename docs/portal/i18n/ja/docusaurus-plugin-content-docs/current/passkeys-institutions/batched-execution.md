---
title: バッチ実行
---

Paliスマートアカウントは `wallet_sendCalls` によるbatch executionをサポートします。ユーザーは複数のcallsを確認し、1つのaccount actionとして承認します。`atomicRequired` がtrueの場合、Paliは選択されたcallsを1つのsmart-account executionとして準備します。targetが空のcontract deployment callはこのflowではサポートされません。

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>Paliはスマートアカウントのbatch全体を確認し、一般的なtoken callsをデコードしてから、1回のsmart-account承認を行います。</figcaption>
</figure>

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>1回の承認でbatch全体がアトミックに実行されます。</figcaption>
</figure>
