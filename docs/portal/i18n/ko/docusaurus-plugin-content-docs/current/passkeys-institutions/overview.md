---
title: Pali 스마트 계정
---

Pali 스마트 계정은 Pali가 사용자를 위해 생성, 연결, 실행할 수 있는 contract account입니다. 일반 사용자에게는 지갑 계정처럼 보입니다. dapp 요청을 확인하고 passkey 또는 지갑 키로 승인하면 Pali가 transaction을 전송합니다. 내부적으로는 modular 구조이며 validator module이 action을 승인하고 executor module이 recovery 같은 기능을 추가합니다.

## 간단한 모델

- 하나의 account address가 자금을 보관하고 dapp도 그 주소를 봅니다.
- 계정은 passkey, ECDSA 또는 composite policy를 사용할 수 있습니다.
- Guardian recovery는 delay 후 active validator를 교체할 수 있습니다.
- `wallet_sendCalls`는 여러 call을 하나의 atomic action으로 실행할 수 있습니다.

## 기술 모델

`PaliSmartAccount`는 call을 실행하고 ERC-7579-style module로 signature를 검증합니다. `PaliSmartAccountFactory`는 deterministic address를 계산하고 계정을 deploy합니다. Pali는 내부적으로 ERC-4337-style encoding을 사용하고 EIP-1271로 contract signature를 검증합니다.

## 두 가지 역할: validator는 서명하고 guardian은 복구합니다

ERC-7579는 module 역할을 분리하며, Pali는 이 분리를 의도적으로 활용합니다.

- **Validator**는 서명 권한입니다. validator는 특정 승인(passkey proof, ECDSA signature, composite policy 결과)이 계정 action을 인가하는지 결정합니다. transaction을 승인할 수 있는 것은 validator뿐입니다.
- **Executor**는 서명이 아닌 계정 동작을 추가합니다. Pali의 guardian recovery module은 executor입니다. guardian은 서명하거나 자금을 이동할 수 없으며, active validator의 timelock 교체를 schedule할 수만 있습니다.

이 역할 분리가 recovery를 안심하고 권장할 수 있는 이유입니다. guardian이 침해되더라도 공격자에게 서명 권한이 주어지지 않습니다. 공격자가 얻는 것은 지연되고, 눈에 보이며, 취소 가능한 recovery 시도뿐입니다.

## Composite 서명 policy

composite validator는 자식 validator를 threshold 아래에서 결합하여 하나의 계정을 policy engine으로 만듭니다.

- **1-of-N** — 여러 authenticator 중 어느 것으로든 승인할 수 있습니다. 각 기기에 passkey를 두는 개인 계정에 편리합니다.
- **t-of-N** — 정족수가 승인해야 합니다. 공유 treasury, 데스크, 팀이 관리하는 계정에 자연스러운 형태입니다.
- **N-of-N** — 설정된 모든 validator가 승인해야 합니다. 최대 보증이 필요한 계정용입니다.

composite는 중첩될 수 있습니다. composite의 자식이 그 자체로 composite일 수 있으므로, 예를 들어 "CFO 키 AND (데스크 passkey 3개 중 임의의 2개)" 같은 계층적 policy를 custom contract 없이 표현할 수 있습니다. guardian recovery는 어떤 validator policy가 활성화되어 있든 독립적으로 유지됩니다.

## Validator 민첩성과 post-quantum 대비

인가가 교체 가능한 module 안에 있기 때문에 계정은 특정 signature scheme에 묶이지 않습니다. 현재 Pali는 ECDSA(지갑 소유 기본값), P-256 WebAuthn passkey, composite validator를 제공합니다. post-quantum 서명 방식을 포함한 새로운 validator 유형이 배포되면 같은 주소의 같은 계정에 설치됩니다. 그 시점부터는 트랜잭션별 인가를 ECDSA가 전혀 관여하지 않는 방식으로 실행할 수 있습니다. 자금, 내역, 통합은 전혀 이동하지 않으며 서명 권한만 진화합니다.

같은 민첩성은 recovery에도 적용됩니다. guardian recovery module은 표준 서명 검증으로 승인을 확인합니다. 일반 주소에는 순수 ECDSA, contract account에는 ERC-1271을 사용하므로, guardian 자체가 composite·custom·post-quantum validator로 관리되는 스마트 계정일 수도 있습니다. 배포된 contract account guardian을 쓰면 recovery 경로가 그 계정의 signature scheme을 상속합니다. 그래서 서명과 **recovery 모두** 궁극적으로 고전 ECDSA 의존 없이 운영될 수 있습니다. 현재 Pali의 guardian UX는 키 기반 승인을 수집하지만, on-chain module이 이미 지원하므로 contract account guardian 플로우는 나중에 지갑에 추가할 수 있습니다.

## 기관과 팀을 위해

기관은 Pali 스마트 계정을 단순한 passkey login이 아니라 account infrastructure로 다뤄야 합니다. Passkey는 쉬운 onboarding에, ECDSA 또는 composite validator는 팀이나 hardware wallet control에, guardian recovery는 delay가 있는 교체 경로에 적합합니다. Deployment와 execution을 위해 gas payer 계정도 funded 상태여야 합니다.

dapp이 external ECDSA owner를 요청하면 Pali는 별도로 경고합니다. 그 주소는 이후 계정 action을 승인할 수 있기 때문입니다.

## Dapp method

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

## 지원 네트워크

Pali 스마트 계정은 Pali가 기대하는 주소에 Pali factory와 module이 존재하는 호환 EVM 체인에서 사용할 수 있습니다. 이는 Pali가 운영하는 체인으로 제한되지 않습니다. 활성 체인이 canonical CREATE2 deployer를 제공하면 Pali가 누락된 스마트 계정 설정을 지갑 안에서 배포할 수 있습니다. Pali Settings를 열고 Advanced로 이동한 뒤 **Smart account setup**의 Deploy 버튼을 사용하세요.

Passkey validator에는 P-256 WebAuthn 검증 지원이 필요합니다. 많은 최신 EVM 환경은 P-256/passkey precompile로 이를 제공하지만, passkey validator에 의존하기 전에 체인 지원을 확인해야 합니다.

## 사용자 제어

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>지갑 검토 후 선택한 validator가 passkey 기반이면 브라우저 또는 운영체제가 WebAuthn passkey 생성을 처리합니다.</figcaption>
</figure>

사용자는 승인 전에 요청한 사이트, 계정 라벨, 요청된 authenticator, 외부 ECDSA owner 주소를 확인할 수 있습니다. Pali가 새 passkey credential이 필요하면 브라우저 또는 운영체제가 WebAuthn 프롬프트를 표시합니다. 스마트 계정이 dapp에 연결되기 전에 Pali는 배포, 모듈 설치, 확인 진행 상황을 보여줍니다.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-dapp-onboarding-video.png" src="/video/smart-account-dapp-onboarding.mp4" title="Smart-account dapp onboarding flow"></video>
  <figcaption>Dapp에서 시작하는 온보딩: 요청을 검토하고 확인하면 스마트 계정이 바로 사용 가능해집니다.</figcaption>
</figure>
