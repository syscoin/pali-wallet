---
title: Pali로 테스트하기
---

수동 integration testing에는 Syscoin test dapp을 사용하고, application logic에는 자체 automated test를 사용하세요.

## Hosted test dapp

Syscoin test dapp은 다음 위치에 hosted되어 있습니다.

```text
https://syscoin-test-dapp.vercel.app/
```

여기에는 Pali passkey flow, `wallet_prepareSmartAccount`, `wallet_sendCalls`, ERC-20 allowance batch generation, 일반적인 wallet request가 포함되어 있습니다.

## Local test dapp

공개되지 않은 변경 사항을 테스트해야 하는 경우:

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## Local Pali extension

```bash
git clone https://github.com/syscoin/pali_wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

그런 다음 browser extension developer page를 통해 `build/chrome`을 로드하세요.

## Passkey testing checklist

1. 기본 provider selector를 통해 Pali에 연결합니다.
2. wallet-paid gas 상태로 smart account를 생성하고 Pali가 deployment confirmation을 완료할 때까지 기다립니다.
3. test에서 필요하다면 smart account에 fund를 넣거나 deploy합니다.
4. ERC-20 approve와 `transferFrom` batch를 만듭니다.
5. `wallet_sendCalls`로 batch를 전송합니다.
6. wallet이 decoded calldata와 passkey batch에 대한 단일 WebAuthn approval을 표시하는지 확인합니다.
