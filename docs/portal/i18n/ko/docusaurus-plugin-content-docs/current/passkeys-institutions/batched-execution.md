---
title: 배치 실행
---

Pali 스마트 계정은 `wallet_sendCalls`를 통한 batched execution을 지원합니다. 사용자는 여러 call을 검토하고 하나의 account action으로 승인합니다. `atomicRequired`가 true이면 Pali는 선택된 call들을 하나의 smart-account execution으로 준비합니다. Target이 비어 있는 contract deployment call은 이 flow에서 지원되지 않습니다.
