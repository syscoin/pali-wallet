---
title: 스마트 계정과 passkeys
---

Pali 스마트 계정은 module로 제어되는 EVM contract account입니다. Passkey는 지원되는 제어 방식 중 하나이며 ECDSA와 composite policy도 사용할 수 있습니다.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>사용자는 설정 또는 dapp 요청에서 모듈형 스마트 계정을 만들고, 승인을 제어할 validator를 선택할 수 있습니다.</figcaption>
</figure>

validator는 "이 계정의 action을 누가 승인할 수 있는가?"에 대한 답이라고 생각하세요. 중요한 점은 계정을 바꾸지 않고도 그 답을 바꿀 수 있다는 것입니다.

- **내 로그인 수단 중 아무거나 하나**(1-of-N): 손에 있는 passkey나 키 중 어느 것으로든 승인합니다.
- **우리 중 몇 명이 함께**(t-of-N): 사람이나 기기의 정족수가 동의해야 하며, 공동 자금에 이상적입니다.
- **우리 모두가 함께**(N-of-N): 설정된 모든 로그인 수단이 승인해야 하며, 가장 민감한 계정에 적합합니다.

policy는 다른 policy를 포함할 수도 있으므로 팀은 "리드의 키와 데스크 passkey 중 임의의 2개" 같은 구성을 표현할 수 있습니다. policy가 바뀌어도 주소, 잔액, 내역은 그대로 유지됩니다. 또한 서명이 modular하기 때문에 (post-quantum을 포함한) 미래의 signature 유형도 나중에 같은 계정에서 채택할 수 있습니다.

guardian은 의도적으로 이 목록에 **포함되지 않습니다**. guardian은 transaction을 절대 승인할 수 없으며, 접근 권한을 잃었을 때 느리고 눈에 보이는 recovery를 시작하는 것이 그들의 유일한 권한입니다. 이 분리는 누구에게도 일상적인 통제권을 주지 않으면서 접근 상실로부터 사용자를 보호합니다.

Passkey approval, team owner, batched action, guardian recovery에 유용합니다. Pali는 factory를 통해 deterministic하게 deploy하고 durable metadata를 저장합니다. Guardian recovery는 즉시 실행되지 않습니다. Guardian이 intent에 서명하고 module이 delay와 함께 schedule한 뒤 validator를 교체할 수 있습니다.

on-chain에서 guardian은 일반 키에 한정되지 않습니다. guardian 승인은 ECDSA 또는 ERC-1271로 검증되므로, guardian은 배포된 contract account일 수도 있습니다. 예를 들어 composite·custom·post-quantum validator를 policy로 가진 다른 스마트 계정도 guardian이 될 수 있으며, 이 경우 recovery 경로는 그 guardian의 signature scheme을 상속합니다. 현재 Pali의 guardian 화면은 키 기반 승인을 수집하지만, 배포된 module이 이미 지원하므로 contract account guardian 플로우는 나중에 추가할 수 있습니다.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>스마트 계정 policy 화면에는 설치된 모듈, 활성 validator 세부 정보, guardian recovery, 모듈 관리가 표시됩니다.</figcaption>
</figure>
