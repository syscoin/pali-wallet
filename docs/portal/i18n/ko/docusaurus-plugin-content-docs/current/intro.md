---
title: Pali Wallet에 오신 것을 환영합니다
slug: /
---

Pali Wallet은 하나의 보안 계층에서 account-based 및 UTXO-based 블록체인 접근이 모두 필요한 사용자와 애플리케이션을 위한 브라우저 확장 지갑입니다.

EVM dapp의 경우 Pali는 EIP-1193 요청, EIP-6963 discovery, 계정 권한, 체인 전환, 서명, 트랜잭션, batch call을 지원하는 MetaMask-compatible `window.ethereum` provider를 노출합니다. Syscoin UTXO 및 Bitcoin-style 애플리케이션의 경우 Pali는 account, xpub, change address, PSBT signing, transaction, asset method를 제공하는 `window.pali`를 노출합니다.

Pali는 기관 및 고급 dapp을 위한 passkey smart account도 지원합니다. dapp은 Pali에 WebAuthn-backed smart account를 생성하거나 복구하고, sponsor policy를 연결한 뒤, 나중에 `wallet_sendCalls`를 통해 atomic batch를 실행하도록 요청할 수 있습니다.

## 경로 선택

- **사용자**는 [시작하기](./users/getting-started.md)에서 시작하세요.
- **EVM 개발자**는 [Provider discovery](./developers/provider-discovery.md)와 [EVM API 개요](./evm-api/overview.md)에서 시작하세요.
- **UTXO 및 Syscoin 개발자**는 [UTXO 및 Syscoin API 개요](./utxo-syscoin-api/overview.md)에서 시작하세요.
- **passkey를 사용하는 기관**은 [Passkeys and institutions](./passkeys-institutions/overview.md)에서 시작하세요.

## Provider 표면

| Provider | 체인 계열 | 주요 용도 |
| --- | --- | --- |
| `window.ethereum` | EVM | MetaMask-compatible dapp 통합, 서명, 트랜잭션, 권한, EIP-5792 batch. |
| `window.pali` | UTXO / Syscoin | Syscoin UTXO 계정, PSBT signing, xpub/change address workflow, asset helper. |

## 중요한 안전 모델

Pali는 의도적으로 보수적으로 동작합니다. dapp 연결은 host별로 관리되고, 차단형 approval은 직렬화되며, network-type mismatch는 명시적으로 처리되고, 사용자는 민감한 작업을 extension UI에서 승인합니다. 여러 사이트가 연결될 수 있지만, 각 사이트는 한 번에 하나의 active connected account만 가집니다.
