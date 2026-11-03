---
title: 용어집
---

## Account family

network가 사용하는 wallet account model입니다. EVM account는 account-based입니다. Syscoin UTXO 및 Bitcoin-style account는 UTXO-based입니다.

## EIP-1193

Ethereum wallet이 `provider.request()`를 통해 사용하는 표준 JavaScript provider interface입니다.

## EIP-6963

dapp이 `window.ethereum`에만 의존하지 않고 provider를 discover할 수 있게 하는 multi-wallet discovery standard입니다.

## Pali smart account

일반 EOA private key 대신 WebAuthn credential로 제어되는 EVM smart account입니다.

## PSBT

Partially Signed Bitcoin Transaction. UTXO transaction signing을 조율하기 위한 일반적인 format입니다.

## Sponsor service

Pali smart account execution을 위해 gas sponsorship, relay support 또는 required co-authorization을 제공할 수 있는 institution-operated service입니다.

## SPT

Syscoin Platform Token, Syscoin UTXO 쪽의 asset입니다.

## UTXO

Unspent Transaction Output. Bitcoin-like chain과 Syscoin UTXO가 사용하는 account model입니다.

## WebAuthn

passkey의 기반이 되는 browser standard입니다. 사용자가 platform authenticator, hardware key 또는 synced passkey provider를 통해 cryptographic action을 승인할 수 있게 합니다.

## SLH-DSA

로컬 서명자는 **SLH-DSA-SHA2-128-24**를 사용합니다. 이는 [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd) 초기 초안에서 제안된 서명 횟수 제한이 있는 실험적 프로필이며, FIPS 205에서 일반 용도로 승인된 매개변수 세트가 아닙니다. 설정된 네트워크에서 Pali는 ECDSA, P-256 WebAuthn 패스키, SLH-DSA 및 복합 검증기를 지원합니다. 호환 모듈이 배포되어 있고 필요한 로컬 키 또는 자격 증명을 사용할 수 있어야 합니다.
