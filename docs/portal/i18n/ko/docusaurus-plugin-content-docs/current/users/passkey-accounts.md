---
title: 스마트 계정과 passkeys
---

Pali 스마트 계정은 module로 제어되는 EVM contract account입니다. Passkey는 지원되는 제어 방식 중 하나이며 ECDSA와 composite policy도 사용할 수 있습니다.

Passkey approval, team owner, batched action, guardian recovery에 유용합니다. Pali는 factory를 통해 deterministic하게 deploy하고 durable metadata를 저장합니다. Guardian recovery는 즉시 실행되지 않습니다. Guardian이 intent에 서명하고 module이 delay와 함께 schedule한 뒤 validator를 교체할 수 있습니다.
