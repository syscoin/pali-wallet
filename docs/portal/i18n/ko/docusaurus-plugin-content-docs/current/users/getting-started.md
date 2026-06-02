---
title: 사용자 시작하기
---

Pali를 사용하면 하나의 extension에서 EVM 계정, Syscoin UTXO 계정, passkey smart account를 관리할 수 있습니다.

## 기본 설정

1. Pali extension을 설치합니다.
2. 새 wallet을 만들거나 기존 seed phrase를 가져옵니다.
3. 강력한 password를 설정합니다.
4. seed phrase를 offline으로 백업합니다.
5. 사용할 network를 선택합니다.
6. 신뢰하는 dapp에만 연결합니다.

## dapp에 연결하기

사이트가 access를 요청하면 Pali는 site를 보여주고 계정을 선택할 수 있는 connection popup을 엽니다. dapp은 연결된 account address와 승인된 provider state만 받습니다.

Pali는 연결을 site별로 저장합니다. 서로 다른 site를 서로 다른 계정에 연결할 수 있지만, 각 site는 한 번에 하나의 active account만 가집니다.

## EVM 계정

EVM 계정은 Ethereum-compatible chain, Rollux, Syscoin NEVM, 그리고 MetaMask-style wallet behavior를 기대하는 dapp에 사용하세요.

EVM dapp은 다음을 요청할 수 있습니다.

- account access
- transaction
- personal signature
- typed data signature
- token watch request
- chain add/switch request
- batch call request

## UTXO 계정

UTXO 계정은 Syscoin UTXO 및 Bitcoin-style transaction flow에 사용하세요. UTXO dapp은 xpub-aware state, change address, PSBT signing, transaction broadcast를 요청할 수 있습니다.

## Passkey smart account

Passkey 계정은 WebAuthn credential로 제어되는 smart account입니다. 기관 관리 onboarding, account recovery, sponsored execution에 유용할 수 있습니다. 일부 passkey 계정은 첫 deployment transaction 전까지 counterfactual 상태입니다.
