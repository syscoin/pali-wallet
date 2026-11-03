---
title: 批量执行
---

Pali 智能账户通过 `wallet_sendCalls` 支持批量执行。 每个 `wallet_sendCalls` 请求都由用户批准或拒绝整个批次，无法取消单个调用。受支持的 Pali 智能账户将完整批次准备为一次账户执行。EOA 调用按顺序发送；后续调用失败时，已广播的调用无法回滚。此智能账户流程不支持目标为空的合约部署调用。

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
