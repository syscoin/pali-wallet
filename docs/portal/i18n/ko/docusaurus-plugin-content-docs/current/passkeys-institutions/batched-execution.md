---
title: 배치 실행
---

Pali 스마트 계정은 `wallet_sendCalls`를 통한 batched execution을 지원합니다. 모든 `wallet_sendCalls` 요청에서 사용자는 전체 배치를 승인하거나 거부하며 개별 호출을 선택 해제할 수 없습니다. 지원되는 Pali 스마트 계정은 전체 배치를 하나의 계정 실행으로 준비합니다. EOA 호출은 순차적으로 전송되며 이후 호출이 실패해도 이미 브로드캐스트된 호출은 되돌릴 수 없습니다. 이 스마트 계정 흐름은 대상이 빈 컨트랙트 배포 호출을 지원하지 않습니다.

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
