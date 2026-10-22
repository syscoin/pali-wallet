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

현재 Pali는 로컬에서 사용 가능한 내장 자식 검증기의 승인을 임계값까지 수집합니다. 이 버전은 중첩된 복합 정책이나 외부·다른 기기의 승인 수집을 지원하지 않습니다. 가디언 복구는 활성 검증기 정책과 독립적입니다.

composite policy를 설계할 때는 threshold의 근거를 문서화하세요. 1-of-N은 가용성을, N-of-N은 보증을 최적화하며, t-of-N은 둘 사이의 균형을 잡습니다. validator는 교체 가능한 module이므로 policy(그리고 미래의 post-quantum validator를 포함한 signature scheme까지도)를 account address를 바꾸지 않고 나중에 업그레이드할 수 있습니다. guardian은 executor-role module이며 어떤 validator policy가 활성화되어 있든 독립적으로 유지됩니다.

Pali의 안내형 가디언 복구는 대기 시간 후 활성 검증기를 교체합니다. 완료가 확인될 때까지 이전 승인 방식은 활성 상태입니다. 다만 온체인 실행기는 가디언이 승인한 계정 작업을 실행할 수 있으며 UI의 검증기 교체로만 제한되지 않습니다. 설치된 훅이 추가 제한을 둘 수 있습니다. 임계값을 충족하는 가디언이 침해되면 제어권과 자금이 위험해집니다. 설치된 모듈은 유효한 승인을 요구하고 Pali는 시도마다 새 salt를 사용하며 계약은 계정마다 만료되지 않은 활성 복구 하나만 허용합니다.

:::tip 최신 가디언 복구 안내

[전체 안내](../users/smart-account-validators#guardian-recovery-guide)는 설정, 시작, 완료 및 **Disable guardian recovery**를 설명합니다. 새 정책은 3일 또는 7일 대기를 제공하며 10분은 알려진 테스트넷 전용입니다. 비활성화 확정에는 현재 승인 방식과 가스가 필요합니다. 대기 중인 복구를 무효화하고 복구 경로를 제거하지만 완료된 복구를 되돌릴 수는 없습니다. 결과가 불확실한 거래는 다시 보내기 전에 온체인 상태를 확인하세요. 선택적인 Sysnode 알림에는 확인된 이메일과 지갑 서명이 필요하며, 키를 전달하지 않고 알림 전달도 보장되지 않습니다.

:::
