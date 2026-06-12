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

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali settings screen for recovering smart accounts" />
</a>
  <figcaption>복구 화면에서는 Pali가 만든 계정을 재구성하거나 guardian recovery로 활성 validator를 교체하여 스마트 계정 접근을 복원할 수 있습니다.</figcaption>
</figure>

Recovery는 installed module에 따라 달라집니다. Deterministic account는 wallet anchor, chain, index, factory로 재구성할 수 있습니다. Passkey validator는 관련 WebAuthn credential이 필요합니다. Guardian recovery는 configured delay 이후 active validator를 교체할 수 있습니다.

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>복구와 실행에는 해당 passkey credential의 WebAuthn assertion이 필요합니다.</figcaption>
</figure>
