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
