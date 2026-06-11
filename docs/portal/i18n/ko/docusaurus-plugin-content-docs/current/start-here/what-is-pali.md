---
title: Pali란 무엇인가요?
---

Pali Wallet은 공식 Syscoin wallet extension이며 EVM-compatible 체인을 위한 범용 web3 wallet입니다. Pali는 서로 겹치는 세 유형의 사용자를 위해 설계되었습니다.

- **일반 사용자**: EVM, Syscoin, Rollux, UTXO asset을 위한 안전한 브라우저 지갑을 원하는 사용자.
- **Dapp 개발자**: 같은 extension에서 MetaMask-compatible EVM access와 UTXO access를 모두 원하는 개발자.
- **기관**: Pali smart account, account recovery, smart-account module policy, dapp-driven onboarding을 원하는 기관.

## Pali의 차별점

대부분의 브라우저 지갑은 EVM provider만 노출합니다. Pali는 서로 보완적인 두 표면을 노출합니다.

- EVM dapp용 `window.ethereum`: 일반적인 MetaMask flow와 호환되도록 의도되었습니다.
- Syscoin UTXO 및 Bitcoin-style flow용 `window.pali`.

이를 통해 dapp은 사용자에게 다른 지갑 설치를 요구하지 않고 account-based 체인과 UTXO-based 체인을 넘나드는 경험을 만들 수 있습니다.

## Pali v4의 새로운 점

Pali v4는 속도, 표준, 유연한 서명 권한이라는 세 가지 아이디어를 중심으로 지갑을 처음부터 현대화한 버전입니다.

- **어디서나 더 빠르게.** Pali는 EVM과 UTXO 네트워크 모두에서 RPC 트래픽을 batch 처리하므로 잔액, 내역, 수수료 데이터가 훨씬 적은 round trip으로 로드됩니다. 그 결과 분주하게 기다리게 하는 지갑이 아니라 즉각적으로 반응하는 지갑이 됩니다.
- **표준 기반 smart account.** Pali smart account는 ERC-4337-style execution encoding과 함께 ERC-7579 module 모델을 따릅니다. 계정의 어떤 부분도 독점적인 lock-in이 아니며, validator, executor, 계정 동작은 모두 공개 사양을 따릅니다.
- **인가는 계정과 분리됩니다.** 누가 서명할 수 있는지는 module이 결정하는 사항이지 주소에 새겨진 속성이 아닙니다. 현재는 지갑 소유 ECDSA 키와 P-256 WebAuthn passkey가 여기에 해당합니다. 앞으로는 post-quantum 서명 방식을 포함한 새로운 validator 유형을 같은 주소의 같은 계정에 설치할 수 있으며, 트랜잭션별 인가에 ECDSA가 전혀 관여하지 않게 할 수도 있습니다.
- **조합 가능한 서명 policy.** composite validator는 자식 validator를 threshold 아래에서 결합합니다. 편의성을 위한 1-of-N, 공동 관리를 위한 t-of-N, 최대 보증을 위한 N-of-N입니다. composite는 중첩될 수 있으므로 policy를 계층적으로 구성할 수 있습니다.
- **Guardian은 접근 상실로부터 보호합니다.** Guardian recovery는 (ERC-7579에 따른) 별도의 executor-role module이며 validator와 의도적으로 구분됩니다. guardian은 트랜잭션에 서명할 수 없고, timelock이 적용된 validator 교체를 schedule할 수만 있습니다. 계정이 정상인 동안에는 언제든지 guardian을 추가하거나 제거할 수 있습니다.

## Pali가 나아가는 방향

Pali의 방향은 **crypto frontend를 위한 동적이고 유연한 서명 권한**입니다. dapp, 거래소, 기관용 대시보드, embedded 서비스 등 어떤 frontend든 작업에 꼭 필요한 서명 policy를 지갑에 요청할 수 있어야 합니다. 간편한 onboarding을 위한 passkey, 공유 treasury를 위한 t-of-N composite, recovery를 위한 hardware 기반 guardian, 나아가 아직 존재하지 않는 미래의 validator 유형까지 가능합니다. account address는 안정적으로 유지되면서 그 뒤에 있는 권한만 진화합니다.

## 한눈에 보는 호환성

| 기능 | 지원 표면 |
| --- | --- |
| EIP-1193 provider 요청 | `window.ethereum` |
| EIP-6963 wallet discovery | `window.ethereum` provider announcement |
| 계정 권한 | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| EVM 트랜잭션 및 서명 | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, 관련 signing method |
| EIP-5792 batch 요청 | `wallet_sendCalls`, `wallet_getCapabilities` |
| UTXO account 및 xpub state | `window.pali` 및 `sys_*` method |
| PSBT signing 및 broadcast | `sys_sign`, `sys_signAndSend` |
| Pali smart account 생성 | `wallet_prepareSmartAccount` |

## 현재 passkey 범위

Pali 스마트 계정은 Pali가 사용하는 주소에 Pali factory와 module이 존재하는 EVM 네트워크에서 사용할 수 있습니다. 이 Pali build는 `zkTanenbaum` testnet(`57057`)을 설정하며, zkSYS production support는 production address가 설정되면 같은 architecture를 사용합니다.

이 인프라는 Pali가 운영하는 체인으로 제한되지 않습니다. canonical CREATE2를 지원하는 호환 EVM 네트워크에서는 Pali가 필요한 스마트 계정 설정을 지갑 안에서 배포할 수 있습니다. Pali Settings를 열고 Advanced로 이동한 뒤 **Smart account setup**의 Deploy 버튼을 사용하세요. Passkey validator에는 P-256 WebAuthn 검증이 필요하며, 많은 최신 EVM 환경은 P-256/passkey precompile로 이를 제공합니다.
