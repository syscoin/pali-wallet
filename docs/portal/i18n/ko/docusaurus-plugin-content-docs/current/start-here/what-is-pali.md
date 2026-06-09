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

Pali smart account는 Pali가 passkey factory contract를 설정했고 체인이 P-256 WebAuthn proof verification을 지원하는 zkSYS-family EVM network에서만 사용할 수 있습니다. 이 Pali build는 `zkTanenbaum` testnet(`57057`)을 설정합니다. zkSYS production support는 production factory address가 Pali에 설정되면 같은 architecture를 사용합니다. dapp은 capability를 확인하고 unsupported chain을 깔끔하게 처리해야 합니다.
