---
title: 批量执行
---

Pali 智能账户通过 `wallet_sendCalls` 支持批量执行。用户查看多个 calls，并将它们作为一次账户操作授权。当 `atomicRequired` 为 true 时，Pali 会把选中的 calls 准备为一次智能账户执行。该流程不支持 target 为空的合约部署 calls。

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>Pali 会审查智能账户的完整批次，并在一次智能账户授权前解码常见的 token calls。</figcaption>
</figure>

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>一次批准即可原子化地执行整个批次。</figcaption>
</figure>
