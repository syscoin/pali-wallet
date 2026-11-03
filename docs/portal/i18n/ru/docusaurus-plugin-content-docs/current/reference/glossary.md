---
title: Глоссарий
---

## Семейство аккаунта

Модель аккаунта кошелька, используемая сетью. EVM accounts являются account-based. Syscoin UTXO и Bitcoin-style accounts являются UTXO-based.

## EIP-1193

Стандартный JavaScript provider interface, используемый Ethereum wallets через `provider.request()`.

## EIP-6963

Стандарт multi-wallet discovery, позволяющий dapps обнаруживать providers, не полагаясь только на `window.ethereum`.

## Pali smart account

EVM smart account, контролируемый WebAuthn credential вместо обычного приватного ключа EOA.

## PSBT

Partially Signed Bitcoin Transaction. Распространенный формат для координации подписания UTXO транзакций.

## Сервис sponsor

Сервис, управляемый институцией, который может предоставлять gas sponsorship, relay support или required co-authorization для Pali smart account execution.

## SPT

Syscoin Platform Token, актив на стороне Syscoin UTXO.

## UTXO

Unspent Transaction Output. Модель аккаунта, используемая Bitcoin-like chains и Syscoin UTXO.

## WebAuthn

Браузерный стандарт, лежащий в основе passkeys. Он позволяет пользователям подтверждать криптографические действия через platform authenticators, hardware keys или synced passkey providers.

## SLH-DSA

Локальный подписант использует **SLH-DSA-SHA2-128-24** — экспериментальный профиль с ограниченным числом подписей из первоначального проекта [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd). Это не набор параметров общего назначения, утверждённый в FIPS 205. В настроенных сетях Pali поддерживает ECDSA, passkey P-256 WebAuthn, SLH-DSA и составные валидаторы; совместимые модули должны быть развёрнуты, а необходимые локальные ключи или учётные данные доступны.
