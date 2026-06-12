---
title: 배치 실행
---

Pali 스마트 계정은 `wallet_sendCalls`를 통한 batched execution을 지원합니다. 사용자는 여러 call을 검토하고 하나의 account action으로 승인합니다. `atomicRequired`가 true이면 Pali는 선택된 call들을 하나의 smart-account execution으로 준비합니다. Target이 비어 있는 contract deployment call은 이 flow에서 지원되지 않습니다.

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-smart-account-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-smart-account-batch.png" alt="Pali wallet_sendCalls smart-account batch review with decoded calldata" />
</a>
  <figcaption>Pali는 스마트 계정 batch 전체를 검토하고 일반적인 token call을 디코딩한 뒤 한 번의 smart-account 승인을 진행합니다.</figcaption>
</figure>

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-batch-sendcalls-video.png" src="/video/smart-account-batch-sendcalls.mp4" title="Smart-account wallet_sendCalls batch flow"></video>
  <figcaption>한 번의 승인으로 batch 전체가 원자적으로 실행됩니다.</figcaption>
</figure>
