---
title: 용어집
---

## Account family

network가 사용하는 wallet account model입니다. EVM account는 account-based입니다. Syscoin UTXO 및 Bitcoin-style account는 UTXO-based입니다.

## EIP-1193

Ethereum wallet이 `provider.request()`를 통해 사용하는 표준 JavaScript provider interface입니다.

## EIP-6963

dapp이 `window.ethereum`에만 의존하지 않고 provider를 discover할 수 있게 하는 multi-wallet discovery standard입니다.

## Passkey smart account

일반 EOA private key 대신 WebAuthn credential로 제어되는 EVM smart account입니다.

## PSBT

Partially Signed Bitcoin Transaction. UTXO transaction signing을 조율하기 위한 일반적인 format입니다.

## Sponsor service

passkey smart account execution을 위해 gas sponsorship, relay support 또는 required co-authorization을 제공할 수 있는 institution-operated service입니다.

## SPT

Syscoin Platform Token, Syscoin UTXO 쪽의 asset입니다.

## UTXO

Unspent Transaction Output. Bitcoin-like chain과 Syscoin UTXO가 사용하는 account model입니다.

## WebAuthn

passkey의 기반이 되는 browser standard입니다. 사용자가 platform authenticator, hardware key 또는 synced passkey provider를 통해 cryptographic action을 승인할 수 있게 합니다.
