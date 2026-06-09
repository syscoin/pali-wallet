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

Guardian recovery는 delay가 있는 validator replacement입니다. Pali는 각 attempt마다 fresh salt를 사용하고 module은 account당 하나의 active recovery만 허용합니다.
