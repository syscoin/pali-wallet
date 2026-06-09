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
