---
title: 복구 및 백업
---

Pali는 non-custodial이므로 백업이 중요합니다. wallet은 seed phrase, password, private key 또는 passkey authenticator secret을 대신 복구할 수 없습니다.

## Seed phrase 백업

wallet seed phrase를 적어 offline으로 보관하세요. seed phrase를 가진 사람은 derived account를 제어할 수 있습니다.

## Passkey backup status

Passkey는 device-bound일 수도 있고 platform account provider에 의해 동기화될 수도 있습니다. Pali는 가능한 경우 backup 관련 status를 표시하지만, 정확한 동작은 authenticator, browser, operating system에 따라 달라집니다.

passkey가 device-bound인지, backup-eligible인지, 또는 backed up/synced인지 암시하는 status가 표시될 수 있습니다. synced passkey는 Apple, Google, Microsoft 같은 platform account를 통해 따라올 수 있으므로 일반적으로 더 편리합니다. device-bound passkey 또는 hardware security key는 더 엄격할 수 있지만, 해당 device를 잃으면 복구가 더 어려워질 수 있습니다.

| 표시될 수 있는 status | 의미 | 편의성 | 보안 tradeoff | 적합한 용도 |
| --- | --- | --- | --- | --- |
| Backed up or synced | passkey가 platform passkey provider에 저장되어 있고 다른 trusted device로 sync될 수 있어 보입니다. | 가장 높음. phone 또는 laptop을 교체한 뒤 platform account에 다시 로그인해 복구할 수 있는 경우가 많습니다. | passkey secret은 여전히 platform passkey system으로 보호되지만, security boundary에는 platform account, account recovery process, synced device가 포함됩니다. | 일상 wallet, dapp account, institution onboarding, 작은 balance. |
| Backup eligible | authenticator는 passkey가 backup 또는 sync될 수 있다고 말하지만, 현재 sync 중이 아닐 수 있습니다. | sync 활성화 여부에 따라 중간에서 높음. | 향후 platform setting이 credential을 cloud sync로 이동시킬 수 있습니다. 이것이 중요하다면 provider 및 device setting을 검토하세요. | recovery flexibility를 원하지만 sync 활성 여부도 확인하려는 사용자. |
| Device-bound or not backed up | passkey가 하나의 authenticator 또는 device에 묶여 있어 보입니다. | 낮음. device를 잃고 다른 recovery path가 없으면 복구가 더 어렵거나 불가능할 수 있습니다. | cloud-synced account 대신 해당 authenticator에 control이 집중되므로 isolation이 더 강합니다. | 큰 balance, 더 높은 보안 계정, hardware security key, cold-wallet-style usage. |
| Unknown or unavailable | browser, OS 또는 authenticator가 충분한 backup information을 노출하지 않았습니다. | 알 수 없음. | cloud recovery 또는 device-bound isolation 중 어느 쪽도 가정하지 마세요. authenticator setup을 확인할 때까지 모호한 것으로 취급하세요. | 임시 사용, testing, 또는 passkey provider를 독립적으로 확인할 수 있는 경우. |

Cloud-synced passkey는 일반적인 사용에는 여전히 안전합니다. private key는 Pali나 dapp에 전달되지 않고, WebAuthn은 origin-bound로 유지되며, user verification도 platform authenticator가 수행합니다. tradeoff는 platform account가 wallet security model의 일부가 된다는 점입니다. cold storage, treasury fund 또는 큰 장기 balance에는 device-bound authenticator 또는 hardware security key를 선호하고, synced passkey account에는 더 작은 operational fund만 보관하세요.

Backup status는 편의성과 보안 사이에서 선택하는 데 도움이 되는 signal입니다. seed phrase backup을 대체하지 않으며, Pali나 기관이 passkey secret을 복구할 수 있다는 의미도 아닙니다.

## Passkey 계정 복구

Pali passkey recovery는 credential-scoped이며 on-chain account discovery를 사용합니다. 같은 passkey credential에서 WebAuthn assertion을 받을 수 있는 모든 Pali 설치는 일치하는 deployed passkey account를 import할 수 있습니다. recovery flow는 다음과 같습니다.

1. discoverable WebAuthn assertion을 요청합니다.
2. factory registry와 creation log에서 일치하는 smart account를 조회합니다.
3. 이미 wallet에 있는 account는 건너뜁니다.
4. sponsor metadata를 해석할 수 있으면 recoverable account를 추가합니다.
5. recoverable account를 wallet에 추가합니다.

## Dapp create/recover idempotence

dapp이 `wallet_createPasskeyAccount`를 호출하면 Pali는 passkey account를 생성하고 deployment transaction이 confirm되며 on-chain metadata가 준비된 passkey credential과 일치한 후 local에 저장합니다.

Passkey account가 on-chain에 존재하지만 local에 없으면 Pali의 wallet recovery flow를 사용합니다. Recovery는 account discovery가 factory registry와 creation log에서 나오기 때문에 같은 credential의 여러 deployed account를 import할 수 있습니다.
