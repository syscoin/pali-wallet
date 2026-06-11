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

## Pali는 무엇이 다른가요?

Pali는 한 가지 생각을 중심으로 만들어졌습니다. 보안 경계는 서버가 아니라 사용자의 지갑이어야 한다는 것입니다. Pali는 다른 브라우저 지갑처럼 RPC node, explorer, indexer에서 데이터를 읽을 수 있지만, custody, approval, recovery, account policy는 사용자의 key와 on-chain module에 남아 있습니다.

- **Custody 또는 recovery 서버가 없습니다.** Pali는 서버 측 key, cloud 기반 암호화 데이터, policy engine, recovery backdoor를 보관하지 않습니다. 민감한 작업은 확장 프로그램에서 승인되고, 사용자의 지갑, passkey, hardware device 또는 smart-account validator가 서명하며, chain이 강제합니다.
- **Fallback이 있는 빠른 읽기.** Pali가 많은 EVM contract read를 해야 할 때 먼저 Multicall3 `aggregate3`를 시도합니다. 이는 하나의 on-chain `eth_call`, 같은 block 기준의 view, call별 failure isolation을 제공합니다. Multicall3가 배포되어 있지 않거나 RPC가 거부하면 JSON-RPC batch로 fallback하고, batch도 사용할 수 없으면 개별 call로 다시 fallback합니다.
- **두 chain family를 하나의 지갑에서.** Pali는 EVM dapp용 MetaMask-compatible `window.ethereum`과 Syscoin UTXO / Bitcoin-style flow용 `window.pali`를 제공합니다. dapp은 account-based asset, UTXO, PSBT, xpub을 하나의 extension에서 다룰 수 있습니다.
- **일반 계정과 smart account.** 사용자는 일반 EOA-style 계정, hardware wallet 계정, Pali smart account를 나란히 유지할 수 있습니다. 일반 계정은 단순하고 portable합니다. Smart account는 passkey, wallet-owned ECDSA validator, composite threshold policy, guardian recovery, custom module 같은 programmable policy를 추가합니다.
- **Standards-first dapp integration.** Pali는 dapp이 이미 사용하는 wallet API를 따릅니다. EIP-1193, EIP-6963, EIP-2255 permission, EIP-5792 `wallet_sendCalls`, EIP-712 typed data, MetaMask-compatible request behavior입니다. Pali smart account는 ERC-7579-style validator/executor module과 ERC-4337-style execution data를 사용합니다.
- **Programmable authorization.** Pali smart account에서는 주소가 안정적으로 유지되지만 signer policy는 진화할 수 있습니다. Validator는 누가 action을 승인할 수 있는지 결정하고, executor는 guardian recovery 같은 기능을 추가합니다. 팀은 자금을 옮기지 않고 passkey에서 threshold policy로 이동하거나 recovery를 추가하거나 새로운 validator type을 채택할 수 있습니다.
- **미래의 더 강한 서명을 위한 설계.** Authorization이 modular하기 때문에 미래의 validator는 ECDSA와 P-256 passkey를 넘어서는 scheme, target chain에서 실용적인 post-quantum signature design도 지원할 수 있습니다.
- **편의성보다 안전성.** Pali는 blocking approval을 직렬화하고, 연결된 site와 network context를 확인하며, send와 approval의 high-risk blacklist hit를 차단하고, guardian recovery를 transaction signing과 분리합니다. Guardian은 delay 이후 access recovery를 도울 수 있지만 몰래 자금을 사용할 수는 없습니다.

Pali의 방향은 **실제 사용자와 실제 dapp을 위한 self-custodial programmable account**입니다. 일상적인 지갑 사용에 충분히 빠르고, 개발자에게 충분히 표준적이며, 기관에 충분히 유연하고, 보안상 중요한 control이 사용자와 chain에 남도록 충분히 보수적입니다.

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
