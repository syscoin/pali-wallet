---
title: 스마트 계정 생성과 복구
---

`wallet_prepareSmartAccount`는 dapp onboarding을 위해 Pali 스마트 계정을 생성합니다. Pali는 계정을 derive하고 configured factory로 deploy하며, 필요하면 requested validator를 설치하고 dapp에 연결한 뒤 durable metadata를 local에 저장합니다.

## 구조

- **Factory:** deterministic address를 계산하고 계정을 deploy합니다.
- **Smart account:** call을 실행하고 installed validator에 확인합니다.
- **Validators:** ECDSA, P-256 WebAuthn passkey, composite.
- **Executors:** delay가 있는 recovery를 위한 guardian recovery.

## Recovery

Recovery는 installed module에 따라 달라집니다. Deterministic account는 wallet anchor, chain, index, factory로 재구성할 수 있습니다. Passkey validator는 관련 WebAuthn credential이 필요합니다. Guardian recovery는 configured delay 이후 active validator를 교체할 수 있습니다.
