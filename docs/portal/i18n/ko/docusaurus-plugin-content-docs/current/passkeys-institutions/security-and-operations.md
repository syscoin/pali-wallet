---
title: 보안 및 운영
---

기관 passkey integration은 단순한 login button이 아니라 production account infrastructure처럼 설계해야 합니다.

## Network 및 verifier dependency

Passkey 계정은 P-256 WebAuthn signature를 검증하기 위한 zkSYS support에 의존합니다. chain이 smart contract를 지원한다는 이유만으로 어떤 EVM chain에서든 passkey account를 만들 수 있다고 가정하지 마세요. 해당 chain에는 passkey factory가 deploy되어 있어야 하고 Pali에는 active chain용 factory address가 설정되어 있어야 합니다.

현재 Pali의 설정된 test deployment는 `zkTanenbaum`(`57057`)입니다. zkSYS production은 factory가 wallet에 설정되면 같은 architecture의 production deployment target으로 취급하세요.

## 운영 checklist

- 각 사용자가 shared Pali passkey account를 받을지 별도 credential을 받을지 결정하세요.
- sponsorship이 disabled, gas-only, required 중 어느 것인지 결정하세요.
- `required` mode를 사용하는 경우 sponsor service uptime을 유지하세요.
- relayer failure, expired deadline, repeated idempotency key를 monitor하세요.
- lost device 및 failed recovery를 위한 user support path를 제공하세요.
- 기관이 execution을 co-authorize할 수 있는지 document하세요.

## Funding 및 deployment

Passkey smart account는 처음 사용하기 전까지 counterfactual일 수 있습니다. 첫 execution에는 deployment gas payer 또는 sponsor path가 필요할 수 있습니다. onboarding flow는 사용자가 사용 전에 account에 fund를 넣어야 하는지 설명해야 합니다.

factory는 deployment 전에 account address를 계산할 수 있습니다. dapp 또는 기관이 첫 on-chain transaction 전에 address를 표시하거나 fund를 보낼 수 있으므로 onboarding에 유용합니다.

## Recovery assumption

Recovery는 passkey-scoped입니다. 사용자는 일반적으로 다음이 필요합니다.

- 관련 WebAuthn credential
- passkey factory에 대한 chain support

Recovery는 custodial backdoor가 아닙니다. chain은 discoverable public metadata와 account list를 제공하지만, 사용자는 control을 증명하기 위해 여전히 관련 WebAuthn credential이 필요합니다.

## Credential backup status

browser와 authenticator가 노출하는 경우 Pali는 WebAuthn credential backup status를 표시할 수 있습니다. 이를 on-chain security rule이 아니라 operational signal로 취급하세요.

Backup status는 credential이 device-bound인지, backup-eligible인지, 또는 platform passkey provider에 의해 현재 backed up/synced 상태인지 나타낼 수 있습니다. synced passkey는 사용자가 Apple, Google, Microsoft 또는 기타 platform account를 통해 credential을 복원할 수 있으므로 편의성과 device-loss recovery를 개선할 수 있습니다. tradeoff는 effective security boundary가 이제 해당 platform account, recovery process, passkey가 sync된 모든 device를 포함한다는 점입니다.

| Credential status | Institution policy implication | User experience | Risk boundary |
| --- | --- | --- | --- |
| Backed up or synced | account recovery와 onboarding convenience가 strict device isolation보다 중요할 때 허용하세요. | device replacement 및 multi-device experience가 가장 좋습니다. consumer passkey의 platform default인 경우가 많습니다. | trust가 platform account, platform recovery flow, synced device로 확장됩니다. |
| Backup eligible | credential이 나중에 sync될 수 있으므로 eligibility만으로 충분한지 결정하세요. | 유연하지만, 사용자는 sync가 활성인지 이해하지 못할 수 있습니다. | account value가 변하면 명확한 user guidance와 periodic status review가 필요합니다. |
| Device-bound or not backed up | high-value, treasury, admin 또는 cold-style account에 선호하세요. | device를 잃으면 friction과 support burden이 커집니다. | 특정 authenticator 또는 hardware key로의 isolation이 더 강합니다. |
| Unknown or unavailable | out-of-band authenticator control이 없는 한 high-assurance policy decision에는 피하세요. | 사용자는 계속 진행할 수 있지만 기관은 credential을 확실히 분류할 수 없습니다. | 모호합니다. cloud backup의 proof나 device-bound isolation의 proof로 취급하지 마세요. |

더 높은 assurance가 필요한 institutional account의 경우 synced passkey가 허용되는지 결정하고 document하세요. synced passkey도 Pali와 dapp이 passkey private key를 받지 않고, WebAuthn이 origin-bound로 유지되며, platform authenticator가 여전히 user verification을 수행하기 때문에 일반 wallet 및 dapp 사용에는 안전합니다. 다만 기관이 platform-account recovery boundary를 명시적으로 받아들이지 않는 한 cold storage, treasury control 또는 큰 장기 balance에는 적절한 default가 아닙니다.

## User communication

명확한 policy text를 사용하세요. 좋은 policy는 다음을 설명합니다.

- sponsor service를 운영하는 주체
- co-authorization이 필요한 action
- 기관이 gas를 지불하는지 여부
- sponsor service를 사용할 수 없을 때 발생하는 일

## Enforcement에 policy text에 의존하지 마세요

`policyText`는 disclosure 및 wallet metadata field입니다. Enforcement는 on-chain policy와 sponsor proof validation을 통해 이루어집니다.
