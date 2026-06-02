---
title: Passkey 계정
---

Passkey 계정은 WebAuthn credential로 제어되는 EVM smart account입니다. 일반 EOA private key로 서명하는 대신, 사용자는 브라우저와 운영 체제가 제공하는 device 또는 account passkey UI로 작업을 승인합니다.

내부적으로 WebAuthn passkey는 P-256 signature를 사용합니다. zkSYS passkey account는 이러한 P-256 proof를 smart account/factory system에서 검증할 수 있도록 설계되어 있으며, 그래서 biometric 또는 platform passkey approval이 on-chain action을 승인할 수 있습니다.

## passkey 계정을 사용하는 이유

- 기관 onboarding을 더 쉽게 합니다.
- Smart account policy를 지원합니다.
- gas 또는 co-authorization을 위한 sponsor service를 선택적으로 사용할 수 있습니다.
- 한 번의 user approval로 batch execution을 수행합니다.
- local wallet metadata가 없을 때 on-chain registry data에서 복구할 수 있습니다.

## 공유 및 별도 passkey

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="passkey 계정 생성을 위한 Pali settings 화면" />
</a>
  <figcaption>사용자는 dapp request뿐 아니라 Settings에서도 passkey 계정을 만들 수 있습니다.</figcaption>
</figure>

Pali는 공유 wallet passkey profile을 사용하거나 계정용 별도 passkey credential을 만들 수 있습니다. 공유 passkey는 하나의 wallet-controlled passkey를 원하는 사용자에게 편리합니다. 별도 passkey는 기관이 service 또는 policy별로 credential을 분리하는 데 도움이 될 수 있습니다.

## Deployment

Passkey smart account는 on-chain에 deploy되기 전에도 counterfactual address로 존재할 수 있습니다. network와 funding path가 지원한다면 첫 execution이 계정을 deploy하고 요청된 action을 하나의 flow에서 수행할 수 있습니다.

계정이 아직 deploy되지 않았다면 passkey account 또는 deployment gas payer에 충분한 native token이 있는지 확인하거나 deployment flow를 지원하는 institution sponsor path를 사용하세요.

## Network support

Passkey 계정에는 zkSYS passkey smart account contract와 P-256 verification support가 필요합니다. 이 Pali build에서는 `zkTanenbaum` testnet이 passkey account creation용으로 설정되어 있습니다. zkSYS production support는 production factory address가 wallet에 설정되면 같은 model을 사용합니다.

## Recovery

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Pali passkey account policy settings 화면" />
</a>
  <figcaption>passkey policy 화면은 가능한 경우 sponsor mode, signer, URL, backup status를 보여줍니다.</figcaption>
</figure>

local wallet state가 삭제되었거나 wallet이 복원된 경우 Pali는 on-chain factory registry와 event log에서 passkey smart account를 복구할 수 있습니다. 복구에는 여전히 관련 passkey의 WebAuthn assertion이 필요합니다.
