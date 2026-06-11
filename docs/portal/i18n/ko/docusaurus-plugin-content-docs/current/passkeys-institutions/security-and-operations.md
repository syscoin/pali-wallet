---
title: 보안과 운영
---

Pali 스마트 계정은 account infrastructure로 다뤄야 합니다. Contract가 자산을 보관하고 installed module이 누가 이동할 수 있는지 결정합니다.

## 체크리스트

- 어떤 validator가 계정을 제어하는지 결정합니다: passkey, ECDSA, composite 또는 recovery.
- External ECDSA owners는 high risk로 다룹니다.
- Guardians, threshold, recovery delay를 정의합니다.
- Gas payer에 자금을 유지합니다.
- Failed deployment, failed module install, expired recovery를 모니터링합니다.

composite validator는 자식 validator를 threshold(1-of-N, t-of-N, N-of-N) 아래에서 결합할 수 있으며, 자식 자체가 composite일 수 있으므로 계층적 policy가 가능합니다.

composite policy를 설계할 때는 threshold의 근거를 문서화하세요. 1-of-N은 가용성을, N-of-N은 보증을 최적화하며, t-of-N은 둘 사이의 균형을 잡습니다. validator는 교체 가능한 module이므로 policy(그리고 미래의 post-quantum validator를 포함한 signature scheme까지도)를 account address를 바꾸지 않고 나중에 업그레이드할 수 있습니다. guardian은 executor-role module이며 어떤 validator policy가 활성화되어 있든 독립적으로 유지됩니다.

Guardian recovery는 delay가 있는 validator replacement입니다. Pali는 각 attempt마다 fresh salt를 사용하고 module은 account당 하나의 active recovery만 허용합니다.
