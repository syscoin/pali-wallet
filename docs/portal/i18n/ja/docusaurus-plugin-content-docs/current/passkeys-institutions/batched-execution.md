---
title: バッチ実行
---

Paliスマートアカウントは `wallet_sendCalls` によるbatch executionをサポートします。 すべての`wallet_sendCalls`要求で、ユーザーはバッチ全体を承認または拒否し、個々の呼び出しを選択解除できません。対応するPaliスマートアカウントは全体を1回のアカウント実行として準備します。EOAの呼び出しは順次送信され、後続が失敗しても配信済みの呼び出しは取り消せません。このスマートアカウントのフローでは、宛先が空のコントラクトデプロイ呼び出しはサポートされません。

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
