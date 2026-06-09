---
title: 보안 모델
---

Pali는 non-custodial wallet입니다. Pali는 private key를 dapp에 노출하지 않습니다. dapp은 injected provider로 요청을 보내고, Pali는 해당 요청을 검증하고 라우팅하며, 사용자는 extension UI에서 민감한 작업을 승인합니다.

## 핵심 원칙

- **Origin-scoped connection:** 연결은 dapp host별로 저장됩니다.
- **dapp당 하나의 active account:** 여러 사이트가 연결될 수 있어도 연결된 사이트 하나는 한 번에 하나의 active account만 가집니다.
- **직렬화된 approval:** popup을 여는 차단형 요청은 사용자가 경쟁하는 approval에 파묻히지 않도록 조율됩니다.
- **Network-family check:** EVM method와 UTXO method는 분리됩니다. 잘못된 계열의 호출은 복구 가능한 dapp error로 처리해야 합니다.
- **명시적 서명:** transaction, PSBT, typed data, message signing, passkey creation, passkey execution, asset watch request, chain change에는 올바른 wallet state와 사용자 approval이 필요합니다.
- **Provider isolation:** Pali는 provider를 top-level page에 inject합니다. iframe에는 inject하지 않습니다.

## dapp이 받는 것

dapp은 public account identifier, provider state, signature, transaction hash, 명시적 RPC result를 받습니다. seed phrase, private key, passkey private material, authenticator secret은 절대 받지 않습니다.

## Passkey 안전성

Pali smart account는 WebAuthn credential을 사용합니다. Pali는 public metadata와 credential identifier를 저장하며, private key material은 authenticator 내부에 남아 있습니다. Pali는 cross-origin WebAuthn assertion을 거부하고 passkey action hash가 준비된 transaction set과 일치하는지 검증합니다.

## Smart-account module policy 안전성

기관 smart-account module policy는 다음으로 나뉩니다.

- **On-chain policy:** mode, sponsor signer, sponsor URL.
- **Wallet metadata:** 표시용 policy text 및 기타 local wallet context.

`policyText` field는 사용자에게 맥락으로 표시됩니다. 이는 on-chain enforcement primitive가 아닙니다.
